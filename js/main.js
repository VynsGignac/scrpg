// ============================================================
// PROTOTYPE : plusieurs personnages (carrés) contrôlés par le joueur, sélectionnables au clic
// (encadrés), déplaçables en faisant un drag depuis un personnage puis en relâchant à l'endroit
// voulu -- et un boss (carré plus gros), non sélectionnable/déplaçable, fixe à sa position de
// départ, avec une barre de vie. Terminer le drag d'un personnage SUR le boss est un ordre
// d'attaque plutôt qu'un déplacement (voir orderAttack/updateCombat) : corps à corps pour
// Guerrier/Paladin/Barbare/Voleur (marche jusqu'au contact), à distance pour Mage/Archère
// (reste à portée). Canvas brut, sans moteur de jeu -- première étape avant d'introduire
// donjons/équipement.
//
// Règles d'évitement (carrés alignés sur les axes) :
// - Dans tous les cas, la destination d'un déplacement ne peut jamais tomber sur un autre
//   personnage : si le point de relâche tombe dans le carré (élargi d'une petite marge) d'un
//   autre, la destination est ramenée au point du bord de ce carré le plus proche du point
//   demandé (trajet supplémentaire minimal). Personne ne peut donc s'arrêter sur quelqu'un d'autre.
// - EN CHEMIN, seuls deux personnages du même "camp" (joueur/joueur) s'évitent réellement : si
//   leur trajet en ligne droite traverse le carré de l'autre, un détour est inséré (voir
//   canPassThrough/pathObstacles). Le boss et les personnages du joueur, eux, se traversent
//   librement pendant le déplacement -- seule leur destination finale est protégée.
// Volontairement basé sur un rectangle (pas un cercle) : un cercle assez grand pour couvrir tout
// le carré en diagonale imposerait un écart bien trop grand quand les personnages sont côte à
// côte à l'horizontale/verticale.
// ============================================================

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Fond d'écran de la scène Combat (demande utilisateur explicite, image fournie par
// l'utilisateur) -- chargé une fois au démarrage ; tant qu'il n'est pas prêt (tout premier
// affichage avant la fin du chargement), le fond uni existant reste visible en repli silencieux,
// voir drawCombatBackground.
const combatBackgroundImage = new Image();
let combatBackgroundReady = false;
combatBackgroundImage.onload = () => { combatBackgroundReady = true; };
combatBackgroundImage.src = 'img/combat-bg.png';

// Dessine l'image en mode "cover" (remplit tout le canvas en conservant ses proportions, recadrée
// si besoin) plutôt qu'étirée -- appelée par-dessus le fond uni déjà peint (voir draw()), donc
// invisible tant que l'image n'est pas prête.
function drawCombatBackground() {
  if (!combatBackgroundReady) return;
  const iw = combatBackgroundImage.width, ih = combatBackgroundImage.height;
  if (!iw || !ih) return;
  const scale = Math.max(canvas.width / iw, canvas.height / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.drawImage(combatBackgroundImage, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
}

// Sprites de classe (demande utilisateur explicite, image fournie par l'utilisateur -- fond noir
// d'origine déjà rendu transparent) : table pour permettre d'en ajouter facilement d'autres plus
// tard. Dessiné à la place du carré uni dans drawCharacter dès que prêt, sinon repli silencieux
// sur le carré uni existant (comme pour combatBackgroundImage ci-dessus).
const CLASS_SPRITES = { Guerrier: new Image() };
CLASS_SPRITES.Guerrier.src = 'img/guerrier.png';

// Bandeau de navigation en haut de l'écran, toujours visible quelle que soit la scène active :
// un bouton par scène. "Combat" n'y figure plus (demande utilisateur explicite) : on y arrive
// uniquement en cliquant un rond de la carte du Monde (voir enterCombatLevel) -- currentScene
// peut donc valoir 'combat' sans qu'aucun bouton du bandeau n'y corresponde.
const TOP_BANNER_HEIGHT = 56;
const SCENES = [
  { key: 'joueur', label: 'Joueur' },
  { key: 'personnage', label: 'Personnage' },
  { key: 'guilde', label: 'Guilde' },
  { key: 'monde', label: 'Monde' },
];
let currentScene = 'monde';

const CHARACTER_SIZE = 36; // 48 * 75% (demande utilisateur explicite : tailles réduites à 75%)
const ENEMY_SIZE = 72;
// Marge supplémentaire (au-delà du strict contact bord à bord) laissée entre deux personnages.
const AVOID_MARGIN = 4;

const cx = window.innerWidth / 2;
const cy = window.innerHeight / 2;

// ------------------------------------------------------------
// Modèle "joueur qui loue un personnage" : deux niveaux distincts.
// - Joueur (humain simulé) : prénom aléatoire, niveau 1-100, deux compétences (APM, Connaissance
//   du jeu) qui s'améliorent par clic comme les jauges des Sims (voir drawSkillRow/incrementSkill).
// - Personnage (loué par le joueur) : classe aléatoire, niveau 1-100, caractéristiques (Force,
//   Agilité, Endurance, Intelligence, Savoir). L'équipement et les passifs/compétences des
//   personnages viendront dans un second temps.
// Un joueur donné (index i) loue le personnage de même index -- association 1 pour 1 pour l'instant.
// ------------------------------------------------------------
const FIRST_NAMES = [
  'Alex', 'Camille', 'Léa', 'Hugo', 'Manon', 'Nathan', 'Chloé', 'Louis', 'Emma', 'Jules',
  'Sarah', 'Maxime', 'Julie', 'Thomas', 'Laura', 'Antoine', 'Marie', 'Lucas', 'Inès', 'Adam',
  'Océane', 'Noah', 'Zoé', 'Gabriel', 'Lina', 'Ethan', 'Jade', 'Léo', 'Anna', 'Mathis',
];
// Les 11 classes ont maintenant toutes 4 compétences définies (voir SKILLS/CLASS_SKILLS) : les 3
// personnages du groupe tirent leur classe au hasard parmi elles toutes.
const CHARACTER_CLASSES = [
  'Guerrier', 'Barbare', 'Paladin', 'Voleur', 'Mage', 'Pyromane',
  'Chasseur', 'Druide', 'Prêtre', 'Sorcier', 'Chaman', 'Gardien',
];

// Couleur de chaque classe (demande utilisateur explicite) -- le carré du personnage prend
// directement la couleur de sa classe (voir sa création plus bas), plutôt qu'une couleur par
// position comme avant. Sorcier (noir) est éclairci en gris très foncé : un carré vraiment noir
// se fondrait dans le fond du canvas (#10151a) et deviendrait quasi invisible/impossible à toucher.
const CLASS_COLORS = {
  Guerrier: '#9e9e9e',
  Barbare: '#e53935',
  Paladin: '#ffc107',
  Voleur: '#8e24aa',
  Mage: '#2196f3',
  Pyromane: '#fb8c00',
  Chasseur: '#8bc34a',
  Druide: '#1b5e20',
  'Prêtre': '#f5f5f5',
  Sorcier: '#3a3a3a',
  Chaman: '#ec407a',
  Gardien: '#546e7a',
};

const SKILL_MAX = 10;

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Caractéristiques de départ par classe (40 points au total pour chacune, demande utilisateur
// explicite) :
// - Endurance fixe selon le style de combat (voir CLASS_COMBAT.melee) : 8 pour les corps à corps
//   (Guerrier/Barbare/Paladin/Voleur/Chaman), 6 pour les classes à distance.
// - Caractéristique "hors sujet" à 0 : Intelligence pour les classes physiques, Force pour les
//   classes magiques -- une classe ne pioche jamais dans la stat de l'autre camp.
// - Au moins 10 points dans la caractéristique principale (Force pour les physiques, Intelligence
//   pour les magiques -- même caractéristique que CLASS_COMBAT.stat, qui détermine déjà les
//   dégâts de l'attaque de base).
// - Le reste (Agilité/Savoir) réparti selon l'usage réel de chaque classe dans ses sorts (voir
//   SKILLS) plutôt qu'au hasard : Savoir seulement pour celles qui ont du soin dans leur kit
//   (Paladin/Chaman/Druide/Prêtre -- 0 pour les autres, qui n'ont aucun sort basé dessus),
//   Agilité seulement pour celles à l'aise en évasion/critique (Voleur/Chasseur/Guerrier/Barbare
//   -- faible à nul pour les casters purs, qui misent tout sur leur stat principale).
const CLASS_STATS = {
  Guerrier: { force: 20, agilite: 10, endurance: 8, intelligence: 0, savoir: 2 },
  Barbare: { force: 26, agilite: 4, endurance: 8, intelligence: 0, savoir: 2 },
  Paladin: { force: 10, agilite: 2, endurance: 8, intelligence: 0, savoir: 20 },
  Voleur: { force: 12, agilite: 20, endurance: 8, intelligence: 0, savoir: 0 },
  Chaman: { force: 0, agilite: 4, endurance: 8, intelligence: 16, savoir: 12 },
  Mage: { force: 0, agilite: 6, endurance: 6, intelligence: 28, savoir: 0 },
  Pyromane: { force: 0, agilite: 6, endurance: 6, intelligence: 28, savoir: 0 },
  Chasseur: { force: 18, agilite: 16, endurance: 6, intelligence: 0, savoir: 0 },
  Druide: { force: 0, agilite: 2, endurance: 6, intelligence: 14, savoir: 18 },
  'Prêtre': { force: 0, agilite: 0, endurance: 6, intelligence: 10, savoir: 24 },
  Sorcier: { force: 0, agilite: 6, endurance: 6, intelligence: 28, savoir: 0 },
  // Gardien : tank pur basé sur la mitigation active (Rempart) plutôt que sur les PV bruts (même
  // Endurance que les autres mêlées) -- pas de Savoir, il ne soigne jamais, seulement lui-même
  // grâce à sa réduction de dégâts. Agilité un peu plus haute que la moyenne (double couche de
  // survie : esquive/crit en plus de la mitigation active).
  Gardien: { force: 16, agilite: 16, endurance: 8, intelligence: 0, savoir: 0 },
};

function statsForClass(className) {
  return { ...(CLASS_STATS[className] || { force: 8, agilite: 8, endurance: 8, intelligence: 8, savoir: 8 }) };
}

// Emplacements d'équipement d'un personnage (voir drawRosterCharacterDetail pour leur affichage,
// et plus bas pour le système d'objets qui les remplit).
const EQUIPMENT_SLOTS = [
  { key: 'tete', label: 'Tête' },
  { key: 'torse', label: 'Torse' },
  { key: 'jambe', label: 'Jambe' },
  { key: 'main', label: 'Main' },
  { key: 'pied', label: 'Pied' },
  { key: 'mainPrincipale', label: 'Main princ.' },
  { key: 'mainSecondaire', label: 'Main sec.' },
  { key: 'collier', label: 'Collier' },
];

function createEmptyEquipment() {
  const equipment = {};
  for (const slot of EQUIPMENT_SLOTS) equipment[slot.key] = null;
  return equipment;
}

// ------------------------------------------------------------
// Objets (demande utilisateur explicite) : chacun boost UNE caractéristique d'une valeur fixe et
// appartient à un emplacement précis (slotKey, voir EQUIPMENT_SLOTS ci-dessus). 5 raretés prévues
// au total, seule la grise est générée pour l'instant (+1 à +3 aléatoire sur une caractéristique
// aléatoire) -- les autres viendront plus tard avec probablement d'autres effets, pas seulement un
// bonus de stat plus gros.
// Tombent en butin à la victoire (voir grantVictoryLoot, 2 objets à chaque fois) dans un
// inventaire commun (inventory) -- rien n'est équipé automatiquement, le joueur choisit lui-même
// où les placer en tapant un emplacement d'équipement (voir openEquipmentPicker/
// drawEquipmentPickerOverlay). setEquippedItem gère aussi bien l'équipement que le retrait (item
// null), et recalcule les caractéristiques effectives du personnage à chaque changement
// (recomputeStats) puisque le bonus ne doit compter que tant que l'objet reste équipé.
// ------------------------------------------------------------
const ITEM_RARITIES = [
  { key: 'gris', label: 'Gris', color: '#9e9e9e' },
  { key: 'vert', label: 'Vert', color: '#66bb6a' },
  { key: 'bleu', label: 'Bleu', color: '#42a5f5' },
  { key: 'violet', label: 'Violet', color: '#ab47bc' },
  { key: 'orange', label: 'Orange', color: '#ffa726' },
];
const ITEM_RARITY_BY_KEY = Object.fromEntries(ITEM_RARITIES.map((r) => [r.key, r]));

const ITEM_STAT_LABELS = {
  force: 'Force', agilite: 'Agilité', endurance: 'Endurance', intelligence: 'Intelligence', savoir: 'Savoir',
};
const ITEM_STAT_KEYS = Object.keys(ITEM_STAT_LABELS);

let inventory = [];
let lastVictoryLoot = []; // les objets obtenus à LA DERNIÈRE victoire -- juste pour l'afficher sur l'écran de fin
let nextItemId = 1;

function generateGrayItem() {
  const eqSlot = EQUIPMENT_SLOTS[Math.floor(Math.random() * EQUIPMENT_SLOTS.length)];
  const statKey = ITEM_STAT_KEYS[Math.floor(Math.random() * ITEM_STAT_KEYS.length)];
  const value = 1 + Math.floor(Math.random() * 3); // 1 à 3 inclus
  return {
    id: nextItemId++,
    rarity: 'gris',
    slotKey: eqSlot.key,
    slotLabel: eqSlot.label,
    statKey,
    statLabel: ITEM_STAT_LABELS[statKey],
    value,
    label: `+${value}`, // affiché dans la petite case d'équipement (voir drawRosterCharacterDetail)
  };
}

function grantVictoryLoot() {
  lastVictoryLoot = [generateGrayItem(), generateGrayItem()];
  inventory.push(...lastVictoryLoot);
}

// Recalcule stats (baseStats + bonus des objets équipés) et, par ricochet, PV/mana max -- appelé
// après tout changement d'équipement (voir setEquippedItem). Plafonne aussi les PV/mana courants
// au cas où le max viendrait de baisser (retrait d'un objet d'Endurance/Savoir en cours de combat).
function recomputeStats(character) {
  const stats = { ...character.baseStats };
  for (const slotKey of Object.keys(character.equipment)) {
    const item = character.equipment[slotKey];
    if (item) stats[item.statKey] = (stats[item.statKey] || 0) + item.value;
  }
  character.stats = stats;
  character.hpMax = stats.endurance * 10;
  character.manaMax = BASE_MANA + stats.savoir * 10;
  character.hp = Math.min(character.hp, character.hpMax);
  character.mana = Math.min(character.mana, character.manaMax);
}

// Équipe "item" dans "slotKey" (ou le vide si item est null) -- l'éventuel ancien occupant du
// slot retourne dans l'inventaire plutôt que d'être perdu.
function setEquippedItem(character, slotKey, item) {
  const current = character.equipment[slotKey];
  if (current) inventory.push(current);
  character.equipment[slotKey] = item || null;
  if (item) inventory = inventory.filter((it) => it.id !== item.id);
  recomputeStats(character);
}

// ------------------------------------------------------------
// Guilde (voir scène "Guilde") : le joueur possède les 11 classes (roster), mais 1 à 4 seulement
// partent en donjon à la fois (activePartyIndices, choisi sur cette scène). Les carrés de combat
// (characters, plus bas) ne sont pas des personnages figés : characters ne contient QUE les
// personnages d'activePartyIndices (aucun repli sur un personnage du roster non choisi -- demande
// utilisateur explicite) -- rebranché à chaque nouveau combat (voir
// applyActivePartyToCombatSlots/resetCombatEncounter), comme l'unique ennemi est déjà reconfiguré
// à chaque rond de la carte du Monde. Les 4 joueurs (humains simulés), eux, existent toujours tous
// les 4 mais ne sont affichés dans la scène Joueur que s'ils louent un emplacement effectivement
// occupé (character.index correspondant, voir drawPlayerScene).
// ------------------------------------------------------------
const PARTY_SIZE = 4;
const SLOT_SPACING = 100;
// Centre les emplacements occupés quel que soit leur nombre (1 à PARTY_SIZE) -- avec 4
// sélectionnés, identique à l'ancien tableau fixe squareXs.
function squareXFor(slot, count) {
  return cx + (slot - (count - 1) / 2) * SLOT_SPACING;
}

// Socle de mana commun à tout le monde, même à 0 en Savoir (Voleur/Chasseur/Mage/Pyromane/
// Sorcier) -- sans ça, ces classes ne pourraient plus jamais lancer AUCUNE compétence dès que
// celles-ci coûtent du mana (demande utilisateur explicite), puisque Savoir est maintenant
// carrément à 0 pour elles (voir CLASS_STATS). Savoir continue d'augmenter le mana au-delà de ce
// socle, donc reste bien la caractéristique de ceux qui lancent beaucoup de sorts (soin surtout).
const BASE_MANA = 50;

const roster = CHARACTER_CLASSES.map((className, i) => {
  // baseStats = valeurs pures de la classe, jamais modifiées ; stats = baseStats + bonus
  // d'équipement (voir recomputeStats), c'est stats qui sert partout ailleurs dans le jeu
  // (dégâts, PV/mana max...) -- garder les deux séparés permet de retirer un objet proprement.
  const baseStats = statsForClass(className);
  const stats = { ...baseStats };
  // PV = Endurance x10 (demande utilisateur explicite).
  const hpMax = stats.endurance * 10;
  const manaMax = BASE_MANA + stats.savoir * 10;
  return {
    rosterId: i, // identité stable dans le roster, indépendante de l'emplacement de combat occupé
    x: cx, y: cy, size: CHARACTER_SIZE, color: CLASS_COLORS[className] || '#4fc3f7',
    selected: false, isMoving: false,
    playerControlled: true, index: 0, className, level: 1, xp: 0,
    label: className.charAt(0), // ex. "M" pour Mage -- affiché sur le carré (voir drawCharacter)
    baseStats, stats, hp: hpMax, hpMax, mana: manaMax, manaMax, threat: 0, lastThreatAt: 0,
    equipment: createEmptyEquipment(),
  };
});

const chosenNames = shuffle(FIRST_NAMES).slice(0, PARTY_SIZE);
const players = chosenNames.map((name, i) => ({
  index: i + 1,
  name,
  level: 1, xp: 0,
  skills: { apm: randomInt(0, 5), connaissanceJeu: randomInt(0, 5) },
}));

// Les 4 premières classes tirées au hasard forment le groupe de départ.
let activePartyIndices = shuffle(roster.map((c) => c.rosterId)).slice(0, PARTY_SIZE);

const characters = [];

// Branche le groupe actif (voir activePartyIndices, modifié depuis la scène Guilde) sur les
// emplacements de combat -- rappelé à chaque nouveau combat (voir resetCombatEncounter), donc un
// changement de composition dans la Guilde ne prend effet qu'au prochain donjon lancé, jamais en
// pleine bataille. Ne branche QUE les personnages réellement sélectionnés (1 à PARTY_SIZE, jamais
// de repli sur un personnage du roster non choisi -- demande utilisateur explicite : sélectionner
// 1 seul personnage ne doit faire apparaître que lui, pas 3 "morts" en plus). Les entités non
// contrôlées par le joueur (l'ennemi, poussé une seule fois dans characters au chargement) restent
// toujours présentes, à leur place, jamais touchées ici.
function applyActivePartyToCombatSlots() {
  const nonPlayerEntities = characters.filter((c) => !c.playerControlled);
  characters.length = 0;
  activePartyIndices.forEach((rosterId, slot) => {
    const rosterChar = roster[rosterId];
    rosterChar.index = slot + 1;
    characters.push(rosterChar);
  });
  characters.push(...nonPlayerEntities);
}
applyActivePartyToCombatSlots();

// Les 5 combats de la carte du Monde (voir drawWorldScene) : un seul emplacement d'ennemi existe
// dans le jeu (toujours dernier dans characters, voir applyActivePartyToCombatSlots), reconfiguré
// à chaque rond choisi (voir resetCombatEncounter) -- taille, PV, couleur, dégâts (melee ou à
// distance) et lettre affichée sur le carré changent, pas le reste du moteur de combat (évitement,
// riposte passive, etc., déjà génériques).
// Tailles à 75% de leur valeur d'origine (44/52/64/50/76, demande utilisateur explicite).
// bombAttack (voir updateBombAttack) : 'noAggroPlayer' fonce poser 1 bombe sous un joueur sans
// aggro (Gobelin), 'random' tire un nombre de bombes à des points aléatoires de la map sans se
// déplacer (Archer gobelin) -- toutes les 10s (BOMB_INTERVAL_MS) dans les deux cas. stationary
// (Artificier gobelin) : ne s'approche jamais de personne (voir updateEnemyAI), attaque quand
// même au corps à corps si un joueur vient à lui. flyingBombAttack : lâche en plus une bombe
// volante (voir launchFlyingBomb/updateFlyingBombAttack) selon un délai variable (base +
// bonus de proximité).
const ENCOUNTERS = [
  { name: 'Gobelin', label: 'G', color: '#8bc34a', size: 33, hpMax: 1500, statValue: 10, combat: { melee: true, stat: 'force' }, bombAttack: { targeting: 'noAggroPlayer', count: 1 } },
  { name: 'Archer gobelin', label: 'A', color: '#cfd8dc', size: 39, hpMax: 2000, statValue: 16, combat: { melee: false, stat: 'force' }, bombAttack: { targeting: 'random', count: 3 } },
  { name: 'Artificier gobelin', label: 'Ar', color: '#f4511e', size: 48, hpMax: 2000, statValue: 26, combat: { melee: true, stat: 'force' }, stationary: true, flyingBombAttack: true },
  { name: 'Sorcière', label: 'S', color: '#ab47bc', size: 38, hpMax: 600, statValue: 22, combat: { melee: false, stat: 'force' } },
  { name: 'Seigneur des ombres', label: 'B', color: '#c62828', size: 57, hpMax: 5000, statValue: 30, combat: { melee: true, stat: 'force' }, isBoss: true },
];

// Boss : plus gros, pas contrôlable par le joueur, a une barre de vie (voir drawEnemyHealthBar).
// Choisit un personnage au hasard à sa première action et le poursuit/attaque pendant tout le
// combat (voir updateEnemyAI) -- ne change jamais de cible. Ses stats de départ viennent du
// premier combat (voir resetCombatEncounter, appelé à chaque rond choisi sur la carte).
const bossSpawn = clampPointToField({ size: ENCOUNTERS[0].size }, cx, cy - 220);
characters.push({
  x: bossSpawn.x, y: bossSpawn.y, size: ENCOUNTERS[0].size, color: ENCOUNTERS[0].color,
  selected: false, isMoving: false, playerControlled: false,
  hp: ENCOUNTERS[0].hpMax, hpMax: ENCOUNTERS[0].hpMax, label: ENCOUNTERS[0].label, name: ENCOUNTERS[0].name,
  facingAngle: Math.PI / 2, // tourné vers le bas (zone de départ des personnages) -- voir Coup sournois
  combatOverride: ENCOUNTERS[0].combat,
  stats: { force: ENCOUNTERS[0].statValue }, // seule stat nécessaire au calcul de dégâts générique
});

const enemies = characters.filter((c) => !c.playerControlled);

// Statistiques du combat en cours (voir écran de fin, drawCombatEndScreen) -- initialisées tout
// de suite (pas seulement dans enterCombatLevel) pour que les dégâts soient comptés même si le
// joueur va directement dans l'onglet Combat sans passer par la carte du Monde en premier.
let combatStats = createCombatStats();
let expandedStatsCharacter = null; // personnage dont le détail est déplié sur l'écran de fin

const PIXELS_PER_MS = 0.045; // vitesse de déplacement des personnages (constante sur tout le trajet) -- 0.09 / 2 (demande utilisateur explicite : tous les déplacements 2x plus lents)

// Lance un déplacement vers (rawX, rawY), en ajustant la destination et en calculant un chemin
// qui évite les autres personnages (voir en-tête du fichier).
function startMove(character, rawX, rawY) {
  const dest = resolveDestination(character, rawX, rawY);
  const path = computeAvoidancePath(character, character.x, character.y, dest.x, dest.y);
  character.pathPoints = path;
  character.isMoving = path.length > 0;
}

// ------------------------------------------------------------
// Premier combat : terminer un déplacement SUR un ennemi (voir pointerup) est un ordre
// d'attaque, pas un simple déplacement. Corps à corps (Guerrier/Paladin/Barbare/Voleur) : le
// personnage marche jusqu'à l'ennemi -- resolveDestination (voir plus bas) l'arrête déjà tout
// seul juste à son contact, comme n'importe quelle destination tombant sur un autre personnage,
// donc aucune logique de portée à ajouter pour eux. Distance (Mage/Archère) : s'approche
// seulement jusqu'à RANGED_ATTACK_RANGE si trop loin, sinon attaque immédiatement sans bouger.
// ------------------------------------------------------------
// "stat" ici = la caractéristique qui détermine les dégâts de l'ATTAQUE DE BASE (100% de sa
// valeur, voir updateCombat) : Force pour tout le monde, Intelligence pour les lanceurs de sorts
// (Mage) -- demande utilisateur explicite. "melee" ne concerne lui que le comportement de
// déplacement/portée (corps à corps ou à distance), indépendant de la caractéristique de dégâts.
const CLASS_COMBAT = {
  Guerrier: { melee: true, stat: 'force' },
  Paladin: { melee: true, stat: 'force' },
  Barbare: { melee: true, stat: 'force' },
  Voleur: { melee: true, stat: 'force' },
  Mage: { melee: false, stat: 'intelligence' },
  Pyromane: { melee: false, stat: 'intelligence' },
  // Portée la plus longue du jeu (demande utilisateur explicite : le Chasseur est "le choix
  // safe", il compense des dégâts plus bas par un style conservateur -- reste hors de portée de
  // tout le monde plus longtemps que n'importe quelle autre classe à distance, voir rangeFor).
  Chasseur: { melee: false, stat: 'force', range: 280 },
  Druide: { melee: false, stat: 'intelligence' },
  'Prêtre': { melee: false, stat: 'intelligence' },
  Sorcier: { melee: false, stat: 'intelligence' },
  Chaman: { melee: true, stat: 'intelligence' }, // magie au corps à corps
  Gardien: { melee: true, stat: 'force' },
};
const DEFAULT_COMBAT = { melee: true, stat: 'force' };
// Portée par défaut des classes à distance -- certaines classes ont leur propre valeur (voir
// CLASS_COMBAT.range, ex. Chasseur) via rangeFor() ci-dessous plutôt que cette constante brute.
const RANGED_ATTACK_RANGE = 220;
const ATTACK_INTERVAL_MS = 2000;

// Portée effective d'un personnage à distance : celle de sa classe si elle en définit une
// (CLASS_COMBAT.range), sinon la portée par défaut commune à toutes les autres.
function rangeFor(character) {
  return combatProfile(character).range || RANGED_ATTACK_RANGE;
}

// ------------------------------------------------------------
// Phase de combat ("pull") : un combat ne démarre pas tout seul.
// - 'prePull' : le joueur peut repositionner ses personnages, mais seulement dans les 2 tiers
//   bas de l'écran (pas trop près des ennemis, voir clampPointToField) -- aucune attaque ni
//   compétence possible, et personne ne joue tout seul (voir updateAutoPlay/updateEnemyAI).
// - 'countdown' : les 10s suivant l'appui sur "Pull" (voir pullCountdownEndAt). Le joueur peut
//   librement se déplacer et lancer des attaques/compétences, mais toujours aucun pilote
//   automatique des deux côtés. Le moindre dégât reçu par un ennemi bascule immédiatement en
//   'active' (voir dealDamage), quel que soit le temps restant.
// - 'active' : combat normal, tout le système déjà en place (auto-play, IA ennemie, etc.).
// ------------------------------------------------------------
const PULL_COUNTDOWN_MS = 10000;
let combatPhase = 'prePull';
let pullCountdownEndAt = 0;

// DPS en temps réel (voir bouton "Entraînement" dans l'onglet Sélection roster / drawDpsHud) :
// horodatage du passage en 'active' (voir dealDamage et loop plus bas), remis à zéro à chaque
// nouveau combat -- le DPS affiché se base sur le temps écoulé depuis ce moment-là, pas depuis le
// pull. isTrainingCombat désactive aussi l'écran de victoire/défaite et la progression du Monde
// (voir checkCombatOutcome) : le mannequin d'entraînement n'attaque jamais et a énormément de PV,
// ce combat n'est donc censé jamais se terminer tout seul.
let combatActiveStartAt = 0;
let isTrainingCombat = false;

// Pendant 'prePull', un personnage du joueur ne peut pas s'approcher des ennemis (dont la zone
// occupe le tiers haut de l'écran) : seuls les 2 tiers du bas lui sont accessibles.
function prePullMinY() {
  return TOP_BANNER_HEIGHT + (canvas.height - TOP_BANNER_HEIGHT) / 3;
}

function startPullCountdown() {
  if (combatPhase !== 'prePull') return;
  combatPhase = 'countdown';
  pullCountdownEndAt = performance.now() + PULL_COUNTDOWN_MS;
}

// Un ennemi (voir ENCOUNTERS) définit son propre profil de combat (combatOverride) puisqu'il n'a
// pas de classe ; un personnage du joueur, lui, le tient de sa classe (CLASS_COMBAT).
function combatProfile(character) {
  return character.combatOverride || CLASS_COMBAT[character.className] || DEFAULT_COMBAT;
}

// La bombe volante de l'Artificier gobelin (voir launchFlyingBomb) est attaquable comme un ennemi
// -- pas dans le tableau enemies (elle n'a pas d'IA, juste une trajectoire, voir
// updateFlyingBombs), donc cherchée séparément ici plutôt que d'y être ajoutée (éviterait de la
// faire remonter dans le ciblage automatique/les sorts, qui supposent tous un seul ennemi réel).
function hitTestEnemyAt(x, y) {
  return enemies.find((e) => e.hp > 0 && isInsideCharacter(e, x, y))
    || flyingBombs.find((b) => b.hp > 0 && !b.explodedAt && !b.destroyedAt && isInsideCharacter(b, x, y))
    || null;
}

// Déplace "attacker" pour pouvoir attaquer "target" : corps à corps -- marche jusqu'au contact
// (resolveDestination l'arrête déjà tout seul juste à côté, comme pour toute destination tombant
// sur un autre personnage) ; à distance -- s'approche seulement jusqu'à RANGED_ATTACK_RANGE si
// trop loin, sinon ne bouge pas (déjà à portée, l'attaque commence sur place, voir updateCombat).
// Utilisé aussi bien pour un personnage du joueur attaquant un ennemi (orderAttack) que pour un
// ennemi attaquant un personnage (updateEnemyAI) -- la logique est identique des deux côtés.
function approachForCombat(attacker, target) {
  const combat = combatProfile(attacker);
  const dist = Math.hypot(attacker.x - target.x, attacker.y - target.y) || 1;
  const dirX = (attacker.x - target.x) / dist;
  const dirY = (attacker.y - target.y) / dist;

  if (combat.melee) {
    // Vise un point légèrement à l'intérieur de la cible, dans la direction réelle de
    // l'attaquant (pas pile le centre) : resolveDestination le ramène de toute façon au contact,
    // mais viser EXACTEMENT le centre est un cas à égalité parfaite entre les 4 bords, qui
    // retombait donc toujours sur "à gauche de la cible" quelle que soit la position de départ.
    const nudge = Math.min(target.size / 2 - 1, 20);
    startMove(attacker, target.x + dirX * nudge, target.y + dirY * nudge);
  } else {
    const range = rangeFor(attacker);
    if (dist > range) startMove(attacker, target.x + dirX * range, target.y + dirY * range);
  }
}

function orderAttack(character, enemy) {
  character.attackTarget = enemy;
  approachForCombat(character, enemy);
}

// ------------------------------------------------------------
// Menace ("aggro") : chaque personnage du joueur a une menace (character.threat) qui augmente
// quand il inflige des dégâts, en subit, ou soigne (voir dealDamage/healCharacter) -- un seul
// ennemi actif à la fois dans ce jeu, donc pas besoin d'une menace par ennemi séparée. Calculée
// paresseusement (pas de décroissance tick par tick) : le total accumulé (threat) et l'instant du
// dernier événement (lastThreatAt) suffisent pour retrouver la valeur courante à tout moment, qui
// décroît linéairement à partir de cet instant pour atteindre exactement 0 après THREAT_DECAY_MS
// sans nouvel événement (demande utilisateur explicite : "5 secondes d'inactivité -> menace 0").
// ------------------------------------------------------------
const THREAT_DECAY_MS = 5000;

function addThreat(character, amount, now) {
  if (!character.playerControlled || amount <= 0) return;
  character.threat = (character.threat || 0) + amount;
  character.lastThreatAt = now;
}

// Le Paladin et le Gardien (tanks, demande utilisateur explicite) génèrent plus de menace pour
// TOUT ce qu'ils font eux-mêmes -- attaque de base, dégâts de compétence, soin, bonus de menace
// des sorts de provocation (Mur sacré/Coup de bouclier/Cri de défi, déjà au-dessus de la moyenne,
// multipliés eux aussi) -- mais pas pour la menace qu'ils accumulent en ENCAISSANT des coups, qui
// reste la menace brute non multipliée (voir l'appel direct à addThreat dans dealDamage pour la
// cible). D'où un multiplicateur appliqué ici, à la source d'une action, plutôt que dans addThreat
// lui-même qui sert aux deux cas.
const TANK_THREAT_MULTIPLIER = 2;
const TANK_THREAT_CLASSES = new Set(['Paladin', 'Gardien']);

function addOwnActionThreat(character, amount, now) {
  const multiplier = TANK_THREAT_CLASSES.has(character.className) ? TANK_THREAT_MULTIPLIER : 1;
  addThreat(character, amount * multiplier, now);
}

function effectiveThreat(character, now) {
  const elapsed = now - (character.lastThreatAt || 0);
  if (elapsed >= THREAT_DECAY_MS) return 0;
  return Math.max(0, (character.threat || 0) * (1 - elapsed / THREAT_DECAY_MS));
}

function highestThreatPlayer(now) {
  let best = null;
  let bestThreat = -1;
  for (const c of characters) {
    if (!c.playerControlled || c.hp <= 0) continue;
    const t = effectiveThreat(c, now);
    if (t > bestThreat) {
      bestThreat = t;
      best = c;
    }
  }
  return { best, bestThreat };
}

// ------------------------------------------------------------
// Bombes (voir ENCOUNTERS/bombAttack, demande utilisateur explicite) : toutes les
// BOMB_INTERVAL_MS, un ennemi avec bombAttack en pose -- 'noAggroPlayer' (Gobelin) fonce
// (vitesse multipliée, voir BOMB_DASH_SPEED_MULTIPLIER/updateMove) se placer sous un joueur qui
// n'a PAS l'aggro actuelle (enemy.attackTarget), 'random' (Archer gobelin) tire bombAttack.count
// bombes à des points aléatoires de la map sans se déplacer. Chaque bombe est télégraphiée (icône
// + zone qui se referme, voir drawBomb) puis explose après BOMB_FUSE_MS en infligeant BOMB_DAMAGE
// à quiconque reste dans BOMB_RADIUS -- pas forcément sa cible initiale (mode noAggroPlayer), qui
// peut donc s'en écarter entre-temps.
// ------------------------------------------------------------
const BOMB_INTERVAL_MS = 10000;
const BOMB_FUSE_MS = 5000;
const BOMB_RADIUS = 70;
const BOMB_DAMAGE = 50;
// Bombes au sol (Gobelin/Archer gobelin) en noir -- la bombe volante de l'Artificier gobelin, elle,
// reste en bleu (FLYING_BOMB_COLOR_RGB, plus bas) : deux couleurs distinctes demandées explicitement.
const BOMB_COLOR_RGB = '20, 20, 20';
const BOMB_ACCENT_RGB = '224, 224, 224'; // anneau de mèche : clair, pour rester lisible sur fond noir
// x2 la vitesse de base actuelle (0.045, voir PIXELS_PER_MS) = 0.09, la valeur de vitesse d'avant
// le ralentissement global 2x (demande utilisateur explicite : "2 fois plus vite, valeur précédente").
const BOMB_DASH_SPEED_MULTIPLIER = 2;
let activeBombs = [];
let nextBombId = 1;

function spawnBomb(x, y, source) {
  const now = performance.now();
  activeBombs.push({ id: nextBombId++, x, y, source, plantedAt: now, explodeAt: now + BOMB_FUSE_MS, exploded: false });
}

function updateBombs(now) {
  for (const bomb of activeBombs) {
    if (bomb.exploded || now < bomb.explodeAt) continue;
    bomb.exploded = true;
    for (const character of characters) {
      if (!character.playerControlled || character.hp <= 0) continue;
      if (Math.hypot(character.x - bomb.x, character.y - bomb.y) <= BOMB_RADIUS) {
        dealDamage(character, BOMB_DAMAGE, BOMB_COLOR_RGB, bomb.source, false, 'Bombe');
      }
    }
  }
  // Courte persistance après l'explosion (juste pour laisser le flash de dégâts se voir) avant de
  // retirer la bombe pour de bon.
  activeBombs = activeBombs.filter((bomb) => !bomb.exploded || now - bomb.explodeAt < 300);
}

// Point aléatoire pour le tir de bombes "random" (Archer gobelin, voir updateBombAttack) --
// centre toujours dans la bande centrale de la map en largeur (RANDOM_BOMB_BAND_WIDTH_RATIO,
// demande utilisateur explicite : "66% de la largeur de la zone de combat"), n'importe où en
// hauteur. Réutilise clampPointToField avec un point sans dimension/non-joueur pour ne pas être
// cantonné aux 2 tiers du bas comme le sont les personnages avant le pull.
const RANDOM_BOMB_BAND_WIDTH_RATIO = 0.66;

function randomFieldPoint() {
  const bandWidth = canvas.width * RANDOM_BOMB_BAND_WIDTH_RATIO;
  const bandX = (canvas.width - bandWidth) / 2;
  const x = bandX + Math.random() * bandWidth;
  const y = TOP_BANNER_HEIGHT + Math.random() * (canvas.height - TOP_BANNER_HEIGHT);
  return clampPointToField({ size: 0, playerControlled: false }, x, y);
}

// Tire bombAttack.count bombes à des points aléatoires de la map, sans se déplacer (mode
// 'random', voir spawnBomb).
function fireRandomBombs(enemy, now) {
  if (!enemy.nextBombAt) enemy.nextBombAt = now + BOMB_INTERVAL_MS;
  if (now < enemy.nextBombAt) return;
  enemy.nextBombAt = now + BOMB_INTERVAL_MS;

  const count = enemy.bombAttack.count || 1;
  for (let i = 0; i < count; i++) {
    const point = randomFieldPoint();
    spawnBomb(point.x, point.y, enemy);
  }
}

// Fonce se placer sous un joueur sans aggro puis pose 1 bombe (mode 'noAggroPlayer', voir
// spawnBomb) -- réutilise le système de déplacement existant (pathPoints/isMoving, voir
// updateMove), juste temporairement accéléré (bombDashUntil) pour rendre le geste "rapide"
// (demande utilisateur explicite).
function dashAndPlantBomb(enemy, now) {
  if (enemy.bombDashTarget) {
    if (!enemy.isMoving) {
      spawnBomb(enemy.x, enemy.y, enemy);
      enemy.bombDashTarget = null;
      enemy.bombDashUntil = 0;
    }
    return; // en pleine course (ou vient d'arriver) : rien d'autre à déclencher ce tour-ci
  }

  if (!enemy.nextBombAt) enemy.nextBombAt = now + BOMB_INTERVAL_MS;
  if (now < enemy.nextBombAt) return;
  enemy.nextBombAt = now + BOMB_INTERVAL_MS;

  const withoutAggro = characters.filter((c) => c.playerControlled && c.hp > 0 && c !== enemy.attackTarget);
  const pool = withoutAggro.length > 0 ? withoutAggro : characters.filter((c) => c.playerControlled && c.hp > 0);
  if (pool.length === 0) return;

  const victim = pool[Math.floor(Math.random() * pool.length)];
  enemy.bombDashTarget = { x: victim.x, y: victim.y };
  enemy.pathPoints = [{ x: victim.x, y: victim.y }];
  enemy.isMoving = true;
  enemy.bombDashUntil = now + 3000;
}

function updateBombAttack(enemy, now) {
  if (enemy.bombAttack.targeting === 'random') fireRandomBombs(enemy, now);
  else dashAndPlantBomb(enemy, now);
}

// ------------------------------------------------------------
// Bombe volante de l'Artificier gobelin (voir ENCOUNTERS/flyingBombAttack, demande utilisateur
// explicite) : distincte des bombes posées au sol (voir spawnBomb) -- celle-ci SE DÉPLACE, en
// ligne droite depuis l'artificier vers un point aléatoire du bord bas de la map (l'angle n'est
// donc pas forcément perpendiculaire, mais elle finit toujours par atteindre ce bord). 100 PV,
// attaquable comme un ennemi (voir hitTestEnemyAt, étendu pour la trouver) : détruite en vol, elle
// disparaît sans rien déclencher ; si elle atteint le bord bas, elle explose instantanément sur
// TOUTE la map (pas de rayon, contrairement aux bombes au sol) pour FLYING_BOMB_DAMAGE à chaque
// joueur vivant.
// Délai avant le prochain lancer (demande utilisateur explicite) : ARTIFICIER_BOMB_BASE_MS fixes,
// puis au moment précis où ce délai s'écoule, on compte une seule fois combien de joueurs sont
// dans la zone de proximité (ARTIFICIER_PROXIMITY_RADIUS, tracée en permanence autour de lui, voir
// drawArtificierProximityZone) et on ajoute ARTIFICIER_PROXIMITY_BONUS_MS par joueur trouvé --
// jamais recompté ensuite, le délai total est donc figé dès cet instant.
// ------------------------------------------------------------
const ARTIFICIER_BOMB_BASE_MS = 4000;
const ARTIFICIER_PROXIMITY_BONUS_MS = 3000;
const ARTIFICIER_PROXIMITY_RADIUS = 110; // 220 * 50% (demande utilisateur explicite)
const FLYING_BOMB_HP = 30;
// Vitesse calculée par bombe (voir launchFlyingBomb) plutôt que fixe : met TOUJOURS
// FLYING_BOMB_TRAVEL_MS à traverser l'écran quelle que soit la distance à parcourir (donc quelle
// que soit la taille de l'écran) -- demande utilisateur explicite : "10s pour traverser l'écran".
const FLYING_BOMB_TRAVEL_MS = 15000;
const FLYING_BOMB_DAMAGE = 50;
const FLYING_BOMB_SIZE = 26;
// Bleu (demande utilisateur explicite) -- distinct du noir des bombes au sol (BOMB_COLOR_RGB).
const FLYING_BOMB_COLOR_RGB = '33, 150, 243';
let flyingBombs = [];
let nextFlyingBombId = 1;

function launchFlyingBomb(enemy) {
  // Vise n'importe quel point du bord bas -- l'angle de tir est donc aléatoire, pas forcément
  // perpendiculaire (demande utilisateur explicite), mais elle finit toujours sur ce bord.
  const targetX = Math.random() * canvas.width;
  const targetY = canvas.height;
  const dist = Math.hypot(targetX - enemy.x, targetY - enemy.y) || 1;
  const speed = dist / FLYING_BOMB_TRAVEL_MS; // px/ms -- voir FLYING_BOMB_TRAVEL_MS ci-dessus
  flyingBombs.push({
    id: nextFlyingBombId++,
    x: enemy.x, y: enemy.y,
    vx: (targetX - enemy.x) / dist * speed, vy: (targetY - enemy.y) / dist * speed,
    hp: FLYING_BOMB_HP, hpMax: FLYING_BOMB_HP, size: FLYING_BOMB_SIZE,
    playerControlled: false, name: 'Bombe volante', label: '💣',
    source: enemy,
  });
}

function updateFlyingBombAttack(enemy, now) {
  if (!enemy.nextBombCheckAt) enemy.nextBombCheckAt = now + ARTIFICIER_BOMB_BASE_MS;

  if (!enemy.flyingBombCounted) {
    if (now < enemy.nextBombCheckAt) return;
    const nearby = characters.filter((c) => (
      c.playerControlled && c.hp > 0 && Math.hypot(c.x - enemy.x, c.y - enemy.y) <= ARTIFICIER_PROXIMITY_RADIUS
    )).length;
    enemy.nextFlyingBombAt = enemy.nextBombCheckAt + nearby * ARTIFICIER_PROXIMITY_BONUS_MS;
    enemy.flyingBombCounted = true;
    return;
  }

  if (now < enemy.nextFlyingBombAt) return;
  launchFlyingBomb(enemy);
  enemy.nextBombCheckAt = now + ARTIFICIER_BOMB_BASE_MS;
  enemy.flyingBombCounted = false;
}

function updateFlyingBombs(dt, now) {
  for (const bomb of flyingBombs) {
    if (bomb.destroyedAt || bomb.explodedAt) continue;
    if (bomb.hp <= 0) {
      bomb.destroyedAt = now; // détruite en vol : rien ne se passe (demande utilisateur explicite)
      continue;
    }
    bomb.x += bomb.vx * dt;
    bomb.y += bomb.vy * dt;
    if (bomb.y >= canvas.height) {
      bomb.explodedAt = now;
      for (const character of characters) {
        if (!character.playerControlled || character.hp <= 0) continue;
        dealDamage(character, FLYING_BOMB_DAMAGE, FLYING_BOMB_COLOR_RGB, bomb.source, false, 'Bombe volante');
      }
    }
  }
  flyingBombs = flyingBombs.filter((bomb) => {
    if (bomb.destroyedAt) return false;
    if (bomb.explodedAt) return now - bomb.explodedAt < 300; // court flash avant de disparaître
    return true;
  });
}

// IA d'un ennemi (voir ENCOUNTERS) : attaque le personnage qui a le plus de menace vis-à-vis de
// lui (voir highestThreatPlayer) -- peut donc changer de cible en cours de combat si quelqu'un
// d'autre prend l'aggro. Une provocation active (Fierté du juste) prend le pas sur la menace tant
// qu'elle dure. Tant que personne n'a encore généré de menace (tout juste engagé), une cible
// aléatoire de repli est choisie UNE FOIS et gardée telle quelle (sinon, en tirant au sort à
// chaque image tant que tout le monde est à 0, il changerait d'avis en permanence sans jamais se
// décider à approcher qui que ce soit). S'approche pour attaquer (corps à corps ou à distance
// selon l'ennemi, voir approachForCombat) tant qu'il n'est pas à portée -- comme la cible peut
// elle-même se déplacer entre-temps, il recalcule sa route à chaque fois qu'il arrive quelque
// part sans être à portée.
function updateEnemyAI(enemy, now) {
  if (enemy.hp <= 0 || combatPhase !== 'active') return;
  if (enemy.trainingDummy) return; // mannequin d'entraînement : n'attaque ni ne se déplace jamais

  const alivePlayers = characters.filter((c) => c.playerControlled && c.hp > 0);
  if (alivePlayers.length === 0) return;

  if ((enemy.tauntUntil || 0) > now && enemy.tauntedBy && enemy.tauntedBy.hp > 0) {
    enemy.attackTarget = enemy.tauntedBy;
  } else {
    const { best, bestThreat } = highestThreatPlayer(now);
    if (best && bestThreat > 0) {
      enemy.attackTarget = best;
    } else if (!enemy.attackTarget || enemy.attackTarget.hp <= 0) {
      enemy.attackTarget = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    }
  }

  if (enemy.bombAttack) updateBombAttack(enemy, now);
  if (enemy.flyingBombAttack) updateFlyingBombAttack(enemy, now);

  // Artificier gobelin (demande utilisateur explicite) : ne s'approche jamais de personne, mais
  // continue d'attaquer au corps à corps si un joueur vient se mettre à portée (voir updateCombat,
  // générique -- il suffit de ne jamais lancer approachForCombat pour lui).
  if (enemy.stationary) return;

  const target = enemy.attackTarget;
  if (enemy.isMoving || isInRangeOf(enemy, target)) return;
  approachForCombat(enemy, target);
}

function nearestEnemyTo(character) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const dist = Math.hypot(character.x - enemy.x, character.y - enemy.y);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = enemy;
    }
  }
  return nearest;
}

// Sorts défensifs (protègent/renforcent soi-même en réaction à une attaque) : l'IA ne les lance
// que si le personnage a réellement subi des dégâts récemment (voir AUTO_DEFENSIVE_WINDOW_MS) --
// pas juste "au cas où", pour éviter de les gâcher hors de propos. Lumière divine (soin) n'en
// fait volontairement pas partie : le besoin de soin dépend de l'état du groupe, pas seulement du
// lanceur, et est déjà évalué correctement par lowestHpAlly.
// Carapace d'écorce n'y figure pas : elle protège un allié, pas forcément le lanceur -- se
// déclenche donc comme Lumière divine (dès que disponible, sans condition de "je viens d'être touché").
const AUTO_DEFENSIVE_SKILLS = new Set([
  'murSacre', 'formeDOmbre', 'dephasage', 'postureDefensive', 'peauDePierre',
  'voileDeGivre', 'bouclierDeFlammes', 'repliTactique',
  'voileProtecteur', 'pacteDeProtection', 'boucliersDesAncetres',
]);
const AUTO_DEFENSIVE_WINDOW_MS = 4000;
const AUTO_ABILITY_INTERVAL_MS = 1000; // délai mini entre deux compétences lancées par l'IA

// "Jouent tout seuls" : un personnage NON sélectionné cherche activement l'ennemi le plus proche,
// s'approche pour l'attaquer (voir orderAttack, qui gère le déplacement) et utilise ses
// compétences dès qu'elles sont prêtes (avec un délai mini d'1s entre deux, et les sorts
// défensifs réservés au cas où il vient d'être touché -- voir plus haut). Dès que le joueur le
// sélectionne, cette fonction ne fait plus rien pour lui -- il reprend uniquement les ordres du
// joueur (voir pointerup), plus la riposte passive sans déplacement gérée au début de
// updateCombat ci-dessous, commune à tous.
function updateAutoPlay(character) {
  if (character.selected || character.hp <= 0 || combatPhase !== 'active') return;

  const target = nearestEnemyTo(character);
  if (!target) return;

  // Nouvel engagement, ou cible déjà fixée mais hors de portée après être arrivé (elle a bougé
  // entre-temps) : (re)lance un ordre d'attaque, qui se charge lui-même de l'approche.
  if (character.attackTarget !== target || (!character.isMoving && !isInRangeOf(character, target))) {
    orderAttack(character, target);
  }

  const now = performance.now();
  if (now - (character.lastAutoSkillAt || 0) < AUTO_ABILITY_INTERVAL_MS) return;

  const recentlyHit = now - (character.lastDamageTakenAt || 0) <= AUTO_DEFENSIVE_WINDOW_MS;
  for (const skillId of CLASS_SKILLS[character.className] || []) {
    if (AUTO_DEFENSIVE_SKILLS.has(skillId) && !recentlyHit) continue;
    if (castSkill(character, skillId)) {
      character.lastAutoSkillAt = now;
      break; // un seul sort par image, pour laisser le délai d'1s s'écouler avant le suivant
    }
  }
}

// Inflige des dégâts périodiques à la cible tant que le personnage est arrivé à portée (melee :
// juste à côté, distance : dans RANGED_ATTACK_RANGE) -- "arrivé" = plus en train de se déplacer,
// pas besoin de revérifier la distance puisque orderAttack a déjà choisi une destination valide.
function updateCombat(character, now) {
  if (character.hp <= 0) return; // mort : ne peut plus attaquer

  // Riposte passive, sans déplacement : un personnage du joueur sans cible qui a déjà un ennemi
  // à portée l'attaque sans qu'un ordre explicite soit nécessaire -- qu'il soit sélectionné ou
  // non (la poursuite ACTIVE, avec déplacement, reste elle réservée aux non-sélectionnés, voir
  // updateAutoPlay). Une cible existante n'est jamais remplacée ici : "tant qu'une autre cible
  // n'a pas été définie" (ordre explicite du joueur, ou updateAutoPlay). Réservé à la phase
  // 'active' : avant le pull et pendant le compte à rebours, seule une attaque manuelle du
  // joueur (voir orderAttack/castSkill) peut faire agir un personnage.
  if (character.playerControlled && !character.attackTarget && combatPhase === 'active') {
    const candidate = nearestEnemyTo(character);
    if (candidate && isInRangeOf(character, candidate)) character.attackTarget = candidate;
  }

  const target = character.attackTarget;
  if (!target) return;
  if (target.hp <= 0) {
    character.attackTarget = null;
    return;
  }
  if (character.isMoving) return;
  if ((character.stunnedUntil || 0) > now) return; // étourdi (Gel) : ne peut pas non plus attaquer
  // Cadence d'attaque ralentie (Éclat de glace).
  const atkMultiplier = (character.atkSlowUntil || 0) > now ? (character.atkSlowMultiplier || 1) : 1;
  if (now - (character.lastAttackAt || 0) < ATTACK_INTERVAL_MS * atkMultiplier) return;

  character.lastAttackAt = now;
  const combat = combatProfile(character);
  // Attaque de base = 100% de la stat (Force, ou Intelligence pour les lanceurs de sorts).
  const { amount, crit } = computeStatDamage(character, combat.stat, 1);
  dealDamage(target, amount, '255, 112, 67', character, crit);
}

// Texte flottant montrant les dégâts/soins (voir dealDamage, healCharacter, updateDotEffects) :
// monte et s'estompe puis disparaît -- juste un retour visuel, ne pilote aucune logique de jeu.
const floatingTexts = [];
const FLOATING_TEXT_DURATION_MS = 900;
const FLOATING_TEXT_RISE_PX = 40;

function spawnFloatingText(x, y, text, rgb) {
  floatingTexts.push({ x, y, text, rgb, createdAt: performance.now() });
}

function updateFloatingTexts(now) {
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    if (now - floatingTexts[i].createdAt > FLOATING_TEXT_DURATION_MS) floatingTexts.splice(i, 1);
  }
}

function drawFloatingTexts(now) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 16px sans-serif';
  for (const ft of floatingTexts) {
    const t = (now - ft.createdAt) / FLOATING_TEXT_DURATION_MS;
    const y = ft.y - t * FLOATING_TEXT_RISE_PX;
    const alpha = Math.max(0, 1 - t);
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(0, 0, 0, ${(alpha * 0.8).toFixed(2)})`;
    ctx.strokeText(ft.text, ft.x, y);
    ctx.fillStyle = `rgba(${ft.rgb}, ${alpha.toFixed(2)})`;
    ctx.fillText(ft.text, ft.x, y);
  }
}

// ------------------------------------------------------------------
// Effet visuel de sort (demande utilisateur explicite : "quelque chose de très simple, mais
// pouvoir au moins voir quelque chose") -- un simple anneau qui grandit et s'estompe sur la
// cible touchée, coloré avec le même rgb que le texte de dégâts/soin de ce sort-là (déjà propre à
// chaque sort, voir dealDamage/healCharacter). Accroché directement à dealDamage/healCharacter :
// couvre donc automatiquement l'attaque de base, les 48 sorts et les DOT/brûlures/ticks, sans
// avoir à instrumenter chacun individuellement.
// ------------------------------------------------------------------
const skillEffects = [];
const SKILL_EFFECT_DURATION_MS = 450;

function spawnSkillEffect(x, y, size, rgb) {
  skillEffects.push({ x, y, size, rgb, createdAt: performance.now() });
}

function updateSkillEffects(now) {
  for (let i = skillEffects.length - 1; i >= 0; i--) {
    if (now - skillEffects[i].createdAt > SKILL_EFFECT_DURATION_MS) skillEffects.splice(i, 1);
  }
}

function drawSkillEffects(now) {
  ctx.lineWidth = 3;
  for (const effect of skillEffects) {
    const t = (now - effect.createdAt) / SKILL_EFFECT_DURATION_MS;
    const radius = effect.size / 2 + t * effect.size * 0.6;
    const alpha = Math.max(0, 1 - t);
    ctx.strokeStyle = `rgba(${effect.rgb}, ${alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ------------------------------------------------------------
// Compétences (voir bandeau de sélection, deux premières cases) : deux sorts par classe pour
// l'instant, un clic sur la case lance le sort (pas de visée séparée -- une seule cible possible
// pour l'instant, le boss, donc les sorts offensifs le visent automatiquement s'il est à portée).
// ------------------------------------------------------------

// ------------------------------------------------------------
// Statistiques du combat en cours (voir écran de fin, drawCombatEndScreen) : dégâts infligés et
// subis par personnage, ventilés par compétence (ou "Attaque de base") et par ennemi. Remis à
// zéro à chaque nouveau combat (voir resetCombatEncounter).
// ------------------------------------------------------------
function createCombatStats() {
  const stats = {};
  for (const character of characters) {
    if (!character.playerControlled) continue;
    stats[character.index] = {
      dealt: { total: 0, bySkill: {}, byEnemy: {} },
      taken: { total: 0, bySkill: {}, byEnemy: {} },
    };
  }
  return stats;
}

function recordDamageStat(characterIndex, kind, amount, skillLabel, enemyLabel) {
  const entry = combatStats[characterIndex] && combatStats[characterIndex][kind];
  if (!entry) return;
  const skill = skillLabel || 'Attaque de base';
  entry.total += amount;
  entry.bySkill[skill] = (entry.bySkill[skill] || 0) + amount;
  entry.byEnemy[enemyLabel] = (entry.byEnemy[enemyLabel] || 0) + amount;
}

// Inflige des dégâts à "target" en consommant d'abord son éventuel bouclier (voir Mur sacré),
// puis affiche le nombre flottant correspondant. Le moindre dégât reçu par un ennemi démarre le
// combat pour de bon, même pendant le compte à rebours du pull (voir combatPhase en tête de
// fichier). Génère aussi de la menace (voir plus haut) : pour l'attaquant s'il tape un ennemi,
// pour la cible elle-même si c'est un ennemi qui la frappe -- "source" est facultatif (ex. les
// dégâts environnementaux n'en génèrent pas). "isCrit" ne change que l'affichage (le montant est
// déjà calculé par l'appelant, voir computeStatDamage). "skillLabel" (nom affiché du sort, ou
// "Attaque de base") sert au résumé de fin de combat (voir recordDamageStat/drawCombatEndScreen).
// Renvoie true si le coup a bien porté, false s'il a été complètement évité (Déphasage/Forme
// d'ombre/esquive d'Agilité) -- les sorts qui posent un effet secondaire (brûlure,
// ralentissement...) doivent vérifier ce retour avant de l'appliquer.
function dealDamage(target, amount, rgb, source, isCrit, skillLabel) {
  const now = performance.now();

  // Déphasage (Mage) : insensible à tout dégât, et ne peut plus non plus en infliger tant que
  // ça dure -- vérifié des deux côtés (cible ET source).
  if (target.playerControlled && (target.phaseUntil || 0) > now) return false;
  if (source && source.playerControlled && (source.phaseUntil || 0) > now) return false;

  // Esquive : 1% par tranche de 10 d'Agilité (passif, demande utilisateur explicite) + le bonus
  // temporaire de Forme d'ombre (Voleur) tant qu'elle est active -- les deux s'additionnent.
  if (target.playerControlled) {
    const baseDodge = Math.floor(((target.stats && target.stats.agilite) || 0) / 10) * 0.01;
    const bonusDodge = (target.dodgeUntil || 0) > now ? (target.dodgeChance || 0) : 0;
    if (Math.random() < baseDodge + bonusDodge) {
      spawnFloatingText(target.x + (Math.random() - 0.5) * 24, target.y - target.size / 2 - 34, 'Esquive', '255, 255, 255');
      return false;
    }
  }

  if (!target.playerControlled && combatPhase !== 'active') {
    combatPhase = 'active';
    combatActiveStartAt = now;
  }

  // Réduction de dégâts subis (Posture défensive du Guerrier, Peau de pierre du Barbare...) et
  // bonus de dégâts subis (Frénésie du Barbare sur soi, Frappe des esprits du Chaman sur la
  // cible) -- les deux peuvent cohabiter (ex. vulnérable ET protégé en même temps).
  const reduction = (target.damageReductionUntil || 0) > now ? (target.damageReductionFactor || 0) : 0;
  const takenBonus = (target.damageTakenBonusUntil || 0) > now ? (target.damageTakenBonusFactor || 0) : 0;
  const afterReduction = Math.round(amount * (1 - reduction) * (1 + takenBonus));

  let remaining = afterReduction;
  if (target.shieldHp > 0) {
    const absorbed = Math.min(target.shieldHp, remaining);
    target.shieldHp -= absorbed;
    remaining -= absorbed;

    // Bouclier de flammes (Pyromane) : renvoie une brûlure à quiconque frappe le bouclier.
    if (absorbed > 0 && target.shieldReflectBurn && source) {
      applyDot(source, {
        kind: 'burn', ticksLeft: 2, tickIntervalMs: 1000, rgb: '255, 87, 34',
        skillName: 'Bouclier de flammes', source: target,
        damagePerTick: Math.max(1, Math.round(absorbed * 0.2)),
      });
    }
    // Pacte de protection (Sorcier) : accumule les dégâts absorbés pour les renvoyer à l'expiration.
    if (absorbed > 0 && target.shieldVengeful) {
      target.shieldAbsorbedTotal = (target.shieldAbsorbedTotal || 0) + absorbed;
      target.lastShieldAttacker = source;
    }
    // Voile de givre (Mage) : ralentit quiconque frappe le bouclier.
    if (absorbed > 0 && target.shieldReflectSlow && source) {
      source.slowMultiplier = 0.5;
      source.slowUntil = now + 2000;
    }
  }
  target.hp = Math.max(0, target.hp - remaining);
  spawnFloatingText(
    target.x + (Math.random() - 0.5) * 24, target.y - target.size / 2 - 34,
    `-${afterReduction}${isCrit ? '!' : ''}`, isCrit ? '255, 213, 79' : rgb
  );
  spawnSkillEffect(target.x, target.y, target.size, isCrit ? '255, 213, 79' : rgb);
  // Sert à l'IA pour savoir si elle vient de se faire attaquer (voir AUTO_DEFENSIVE_SKILLS).
  if (target.playerControlled) target.lastDamageTakenAt = now;
  // Posture défensive (Guerrier) : encaisser un coup pendant qu'elle est active génère de la Rage.
  if (target.playerControlled && (target.gainsRageOnHitUntil || 0) > now) {
    target.rage = Math.min(RAGE_MAX, (target.rage || 0) + 1);
  }

  if (!target.playerControlled && source && source.playerControlled) {
    addOwnActionThreat(source, afterReduction, now); // le joueur inflige des dégâts à l'ennemi
    recordDamageStat(source.index, 'dealt', afterReduction, skillLabel, target.name || 'Ennemi');
  } else if (target.playerControlled && source && !source.playerControlled) {
    addThreat(target, afterReduction, now); // le joueur subit des dégâts de l'ennemi
    recordDamageStat(target.index, 'taken', afterReduction, skillLabel, source.name || 'Ennemi');
  }

  // Malédiction (Sorcier) : si la cible meurt maudite, explosion de zone (dégâts à tous les
  // autres ennemis -- prêt pour de futurs combats à plusieurs ennemis).
  if (target.hp <= 0 && target.cursedBy && target.cursedBy.hp > 0 && !target.playerControlled) {
    const caster = target.cursedBy;
    target.cursedBy = null;
    const { amount: burst } = computeStatDamage(caster, 'intelligence', 0.6);
    for (const other of enemies) {
      if (other === target || other.hp <= 0) continue;
      dealDamage(other, burst, '81, 45, 168', caster, false, 'Malédiction (explosion)');
    }
  }

  return true;
}

// Coup critique : 1% de chance par tranche de 10 d'Agilité (demande utilisateur explicite),
// double les dégâts. Calcule aussi les dégâts d'une attaque/compétence à partir d'un % d'une
// caractéristique (Force ou Intelligence) -- base commune à l'attaque de base et aux sorts.
function rollCrit(character) {
  const agi = (character.stats && character.stats.agilite) || 0;
  const chance = Math.floor(agi / 10) * 0.01;
  return Math.random() < chance;
}

// Multiplicateur de dégâts SORTANTS actif sur "character" en ce moment (Cri de rage du Guerrier,
// Frénésie du Barbare...) -- les buffs de ce type se posent tous sur damageOutputMultiplier /
// damageOutputUntil, un seul actif à la fois (le plus récent remplace le précédent).
function damageOutputMultiplier(character, now) {
  return (character.damageOutputUntil || 0) > now ? (character.damageOutputMultiplier || 1) : 1;
}

function computeStatDamage(character, statKey, percent) {
  const base = Math.round(((character.stats && character.stats[statKey]) || 0) * percent * damageOutputMultiplier(character, performance.now()));
  const crit = rollCrit(character);
  return { amount: crit ? base * 2 : base, crit };
}

// Comme computeStatDamage, mais combine DEUX caractéristiques avant d'appliquer le multiplicateur
// de dégâts sortants et le critique (demande utilisateur explicite : les dégâts du Voleur doivent
// se baser en partie sur l'Agilité, en plus de la Force). Les % de chaque sort sont calibrés pour
// donner un total proche de l'ancienne version 100% Force, aux stats de base du Voleur (12 Force,
// 20 Agilité) -- l'Agilité y pèse pour environ 40% du total plutôt que d'être un pur bonus.
function computeHybridStatDamage(character, primaryKey, primaryPercent, secondaryKey, secondaryPercent) {
  const primary = (character.stats && character.stats[primaryKey]) || 0;
  const secondary = (character.stats && character.stats[secondaryKey]) || 0;
  const base = Math.round((primary * primaryPercent + secondary * secondaryPercent) * damageOutputMultiplier(character, performance.now()));
  const crit = rollCrit(character);
  return { amount: crit ? base * 2 : base, crit };
}

// Soigner génère de la menace pour le soigneur, au même titre que les dégâts (demande
// utilisateur explicite) -- y compris en se soignant soi-même (source === target).
function healCharacter(target, amount, source) {
  target.hp = Math.min(target.hpMax, target.hp + amount);
  spawnFloatingText(target.x + (Math.random() - 0.5) * 24, target.y - target.size / 2 - 34, `+${amount}`, '129, 199, 132');
  spawnSkillEffect(target.x, target.y, target.size, '129, 199, 132');
  if (source && source.playerControlled) addOwnActionThreat(source, amount, performance.now());
}

// Effet à tick (brûlure/saignement) : inflige damagePerTick toutes les tickIntervalMs, ticksLeft
// fois. Garde une référence à qui l'a posé (spec.source) pour continuer à générer de la menace en
// son nom à chaque tick, même si le lanceur bouge ou fait autre chose entre-temps.
function applyDot(target, spec) {
  if (!target.dotEffects) target.dotEffects = [];
  target.dotEffects.push({ ...spec, nextTickAt: performance.now() + spec.tickIntervalMs });
  // Empile un compteur de poison distinct de la liste de DOT elle-même (voir Épines
  // empoisonnées, qui consomme ce compteur plutôt que les effets à tick directement).
  if (spec.kind === 'poison') {
    target.poisonStacks = Math.min(5, (target.poisonStacks || 0) + 1);
  }
}

function updateDotEffects(character, now) {
  if (!character.dotEffects || character.dotEffects.length === 0) return;
  for (let i = character.dotEffects.length - 1; i >= 0; i--) {
    const dot = character.dotEffects[i];
    if (now >= dot.nextTickAt) {
      dealDamage(character, dot.damagePerTick, dot.rgb, dot.source, false, dot.skillName);
      dot.ticksLeft -= 1;
      dot.nextTickAt = now + dot.tickIntervalMs;
    }
    if (dot.ticksLeft <= 0) character.dotEffects.splice(i, 1);
  }
}

// ------------------------------------------------------------------
// Brûlure du Pyromane (Boule de feu / Pluie de feu) -- système à part du DOT générique ci-dessus
// (demande utilisateur explicite) : jusqu'à PYRO_BURN_MAX_STACKS stacks cumulables, l'un ou
// l'autre des deux sorts en ajoute un (jusqu'au plafond) et rafraîchit la durée à chaque
// application. La durée (PYRO_BURN_DURATION_MS) dépasse volontairement le cooldown de Boule de
// feu/Pluie de feu (7s/9s) : tant qu'ils sont relancés à chaque cycle, la brûlure ne retombe
// jamais à 0 -- l'objectif de jeu est de maintenir les 3 stacks en continu. Un cycle manqué la
// laisse expirer entièrement (retour à 0), ce qui crée un vrai enjeu d'entretien plutôt qu'un
// simple DOT passif.
// ------------------------------------------------------------------
const PYRO_BURN_MAX_STACKS = 3;
const PYRO_BURN_DURATION_MS = 22000; // > cooldown de Pluie de feu (9000) : survit à un cycle complet si entretenu
const PYRO_BURN_TICK_MS = 1000;
const PYRO_BURN_TICK_COEFFICIENT = 0.07; // par stack, appliqué à l'Intelligence du lanceur

function applyPyroBurnStack(target, character) {
  const now = performance.now();
  target.pyroBurnStacks = Math.min(PYRO_BURN_MAX_STACKS, (target.pyroBurnStacks || 0) + 1);
  target.pyroBurnSource = character;
  target.pyroBurnDamagePerTick = Math.round(character.stats.intelligence * PYRO_BURN_TICK_COEFFICIENT);
  target.pyroBurnExpiresAt = now + PYRO_BURN_DURATION_MS;
  if (!target.pyroBurnNextTickAt || target.pyroBurnNextTickAt <= now) {
    target.pyroBurnNextTickAt = now + PYRO_BURN_TICK_MS;
  }
}

function updatePyroBurn(character, now) {
  if (!character.pyroBurnStacks) return;
  if (now >= character.pyroBurnExpiresAt) {
    character.pyroBurnStacks = 0;
    return;
  }
  if (now >= character.pyroBurnNextTickAt) {
    const total = character.pyroBurnDamagePerTick * character.pyroBurnStacks;
    dealDamage(character, total, '255, 87, 34', character.pyroBurnSource, false, 'Brûlure');
    character.pyroBurnNextTickAt = now + PYRO_BURN_TICK_MS;
  }
}

// Rempart du Gardien (character.rempartStacks) : purement passif une fois posé -- la réduction de
// dégâts elle-même est gérée par le mécanisme générique déjà en place dans dealDamage
// (damageReductionFactor/damageReductionUntil), pas besoin d'y ticker quoi que ce soit. Seul le
// COMPTEUR de stacks doit être remis à 0 une fois expiré (sinon un Rempart relancé après une trop
// longue pause repartirait à tort du dernier compte au lieu de 1, voir applyRempartStack/rempart).
const GARDIEN_REMPART_MAX_STACKS = 5;
const GARDIEN_REMPART_DURATION_MS = 22000; // > cooldown de Rempart (6000) : survit à un cycle complet si entretenu
const GARDIEN_REMPART_REDUCTION_PER_STACK = 0.05; // 5%/stack, jusqu'à -25% à 5 stacks

function updateRempartStacks(character, now) {
  if (character.rempartStacks && now >= (character.rempartExpiresAt || 0)) {
    character.rempartStacks = 0;
  }
}

// Expire un bouclier (Mur sacré, Bouclier de flammes, Pacte de protection...) une fois sa durée
// écoulée -- sa quantité de PV absorbés, elle, est déjà consommée au fil des coups reçus par
// dealDamage ci-dessus. Pacte de protection (Sorcier) est vengeur : à l'expiration, renvoie les
// dégâts accumulés pendant qu'il tenait à quiconque l'a frappé en dernier.
function updateShield(character, now) {
  if (character.shieldHp > 0 && now >= (character.shieldExpiresAt || 0)) {
    character.shieldHp = 0;
  }
  if (character.shieldVengeful && now >= (character.shieldExpiresAt || 0) && character.shieldAbsorbedTotal > 0) {
    const target = character.lastShieldAttacker;
    const amount = character.shieldAbsorbedTotal;
    character.shieldVengeful = false;
    character.shieldAbsorbedTotal = 0;
    character.lastShieldAttacker = null;
    if (target && target.hp > 0) dealDamage(target, amount, '81, 45, 168', character, false, 'Pacte de protection (renvoi)');
  }
}

// "Dans le dos" pour Coup sournois : le boss ne se déplaçant pas, on lui donne une orientation
// fixe (voir facingAngle à sa création, tourné vers la zone de départ des personnages) -- "dans
// le dos" = attaquant à l'opposé de cette direction, à 60° près.
function isBehind(attacker, target) {
  if (typeof target.facingAngle !== 'number') return false;
  const angleToAttacker = Math.atan2(attacker.y - target.y, attacker.x - target.x);
  let diff = angleToAttacker - (target.facingAngle + Math.PI);
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  return Math.abs(diff) <= Math.PI / 3;
}

function lowestHpAlly() {
  const players_ = characters.filter((c) => c.playerControlled && c.hp > 0);
  if (players_.length === 0) return null;
  return players_.reduce((worst, c) => (c.hp / c.hpMax < worst.hp / worst.hpMax ? c : worst));
}

// Chaque sort a désormais son propre cooldown (3-20s, demande utilisateur explicite -- l'ancien
// palier unique de 20s pour tous était "une erreur" selon ses propres mots) : voir le cooldownMs
// de chaque sort ci-dessous, dimensionné selon son rôle (filler court, gros sort long...).
const ZONE_RADIUS = 220; // rayon des sorts de zone centrés sur le lanceur (ex. Cercle sacré)

// Plafond de la Rage du Guerrier (character.rage) : initialement relevé de 5 à 10 pour que Cri de
// rage dépasse +100%, puis redescendu à 5 (demande utilisateur explicite) une fois les cooldowns
// individualisés (voir plus haut) -- avec Frappe rageuse/Tourbillon à 6-8s au lieu de 20s, la
// Rage se génère bien plus vite qu'avant et un plafond à 10 la faisait saturer en continu,
// écrasant tout le reste du roster (testé en simulation). À 5, le Guerrier reste fort sans dominer.
const RAGE_MAX = 5;
// Génération augmentée (demande utilisateur explicite) : atteindre les paliers hauts doit rester
// jouable sur une durée de combat réaliste (cap atteint en moins de 2 cycles au lieu de 5).
const RAGE_GAIN_PER_CAST = 3;

const SKILLS = {
  // ============================== GUERRIER (Force, mêlée) ==============================
  // Ressource Rage (character.rage, 0-RAGE_MAX stacks) : Frappe rageuse/Tourbillon/Posture
  // défensive en génèrent, Cri de rage la consomme entièrement pour un buff de dégâts
  // proportionnel.
  frappeRageuse: {
    id: 'frappeRageuse', name: 'Frappe rageuse', shortLabel: 'Frappe\nrageuse', targeting: 'enemy', cooldownMs: 6000,
    description: '90% Force. Génère 3 Rage.',
    cast(character, target) {
      const { amount, crit } = computeStatDamage(character, 'force', 0.9);
      dealDamage(target, amount, '158, 158, 158', character, crit, 'Frappe rageuse');
      character.rage = Math.min(RAGE_MAX, (character.rage || 0) + RAGE_GAIN_PER_CAST);
    },
  },
  tourbillon: {
    id: 'tourbillon', name: 'Tourbillon', shortLabel: 'Tourbillon', targeting: 'enemy', cooldownMs: 8000,
    description: '60% Force à tous les ennemis. Génère 3 Rage par ennemi touché.',
    cast(character) {
      for (const enemy of enemies) {
        if (enemy.hp <= 0) continue;
        const { amount, crit } = computeStatDamage(character, 'force', 0.6);
        dealDamage(enemy, amount, '158, 158, 158', character, crit, 'Tourbillon');
        character.rage = Math.min(RAGE_MAX, (character.rage || 0) + RAGE_GAIN_PER_CAST);
      }
    },
  },
  postureDefensive: {
    id: 'postureDefensive', name: 'Posture défensive', shortLabel: 'Posture\ndéf.', targeting: 'self', cooldownMs: 12000,
    description: '-40% dégâts subis pendant 4s. Chaque coup encaissé génère de la Rage.',
    cast(character) {
      const now = performance.now();
      character.damageReductionFactor = 0.4;
      character.damageReductionUntil = now + 4000;
      character.gainsRageOnHitUntil = now + 4000; // chaque coup encaissé pendant ce temps génère de la Rage
    },
  },
  criDeRage: {
    id: 'criDeRage', name: 'Cri de rage', shortLabel: 'Cri de\nrage', targeting: 'self', cooldownMs: 18000,
    description: "Consomme toute la Rage : +15% dégâts par stack (jusqu'à +150%), pendant 5s +1.5s par stack.",
    cast(character) {
      const stacks = character.rage || 0;
      character.rage = 0;
      character.damageOutputMultiplier = 1 + stacks * 0.15;
      // La durée du buff grandit aussi avec la Rage dépensée (demande utilisateur explicite,
      // +1.5s par stack en plus du socle de 5s) -- hoarder pour un gros dump n'est donc plus
      // seulement plus fort, c'est aussi plus long : dump souvent (petits bonus courts) ne
      // rapporte plus autant sur la durée qu'attendre les paliers hauts.
      character.damageOutputUntil = performance.now() + 5000 + stacks * 1500;
    },
  },

  // ============================== BARBARE (Force, mêlée) ==============================
  // Sacrifice de PV augmenté et auto-soin réduit (demande utilisateur explicite) : le Barbare
  // reste un glass cannon assumé, mais exploiter son plein potentiel (Éventration/Cercle de sang
  // à répétition) vide désormais sa barre de vie plus vite qu'il ne peut se rattraper seul --
  // nécessite l'attention d'un soigneur pour être soutenable, plutôt qu'auto-suffisant.
  eventration: {
    id: 'eventration', name: 'Éventration', shortLabel: 'Éventration', targeting: 'enemy', cooldownMs: 6000,
    description: '120% Force (x2 si la cible est sous 50% PV). Coûte 12% de vos PV max.',
    cast(character, target) {
      character.hp = Math.max(1, character.hp - Math.round(character.hpMax * 0.12));
      const { amount, crit } = computeStatDamage(character, 'force', 1.2);
      const finalAmount = target.hp / target.hpMax < 0.5 ? amount * 2 : amount;
      dealDamage(target, finalAmount, '229, 57, 53', character, crit, 'Éventration');
    },
  },
  cercleDeSang: {
    id: 'cercleDeSang', name: 'Cercle de sang', shortLabel: 'Cercle\nde sang', targeting: 'enemy', cooldownMs: 10000,
    description: '70% Force à tous les ennemis. Coûte 20% de vos PV max.',
    cast(character) {
      character.hp = Math.max(1, character.hp - Math.round(character.hpMax * 0.2));
      for (const enemy of enemies) {
        if (enemy.hp <= 0) continue;
        const { amount, crit } = computeStatDamage(character, 'force', 0.7);
        dealDamage(enemy, amount, '229, 57, 53', character, crit, 'Cercle de sang');
      }
    },
  },
  peauDePierre: {
    id: 'peauDePierre', name: 'Peau de pierre', shortLabel: 'Peau de\npierre', targeting: 'self', cooldownMs: 14000,
    description: '-30% dégâts subis 5s. Soigne 5% de vos PV max.',
    cast(character) {
      character.damageReductionFactor = 0.3;
      character.damageReductionUntil = performance.now() + 5000;
      healCharacter(character, Math.round(character.hpMax * 0.05), character); // ne compense plus qu'une partie des PV sacrifiés
    },
  },
  frenesie: {
    id: 'frenesie', name: 'Frénésie', shortLabel: 'Frénésie', targeting: 'self', cooldownMs: 16000,
    description: '+30% dégâts infligés (+50% si sous 50% PV) mais +20% dégâts subis, pendant 5s.',
    cast(character) {
      const now = performance.now();
      const desperate = character.hp / character.hpMax < 0.5;
      character.damageOutputMultiplier = desperate ? 1.5 : 1.3; // plus dangereux, plus fort
      character.damageOutputUntil = now + 5000;
      character.damageTakenBonusFactor = 0.2;
      character.damageTakenBonusUntil = now + 5000;
    },
  },

  // ============================== PALADIN (Force/Savoir, mêlée) ==============================
  chatiment: {
    id: 'chatiment', name: 'Châtiment', shortLabel: 'Châtiment', targeting: 'enemy', cooldownMs: 5000,
    description: '110% Force (150% si un bouclier est actif sur vous).',
    cast(character, target) {
      const now = performance.now();
      const empowered = character.shieldHp > 0 && (character.shieldExpiresAt || 0) > now;
      const { amount, crit } = computeStatDamage(character, 'force', empowered ? 1.5 : 1.1);
      dealDamage(target, amount, '255, 193, 7', character, crit, 'Châtiment');
    },
  },
  vagueSacree: {
    id: 'vagueSacree', name: 'Vague sacrée', shortLabel: 'Vague\nsacrée', targeting: 'enemy', cooldownMs: 10000,
    description: '50% Force à tous les ennemis. Vous soigne de 40% des dégâts infligés.',
    cast(character) {
      let totalDealt = 0;
      for (const enemy of enemies) {
        if (enemy.hp <= 0) continue;
        const { amount, crit } = computeStatDamage(character, 'force', 0.5);
        if (dealDamage(enemy, amount, '255, 193, 7', character, crit, 'Vague sacrée')) totalDealt += amount;
      }
      if (totalDealt > 0) healCharacter(character, Math.round(totalDealt * 0.4), character);
    },
  },
  // Rôle hybride tank/heal secondaire (demande utilisateur explicite) : Mur sacré renforcé (plus
  // gros bouclier, plus long, + réduction de dégâts) pour vraiment encaisser, Lumière divine
  // affaibli -- le Paladin soigne "de temps en temps" en complément, le Prêtre reste le vrai gros
  // soin mono-cible (voir plus bas).
  murSacre: {
    id: 'murSacre', name: 'Mur sacré', shortLabel: 'Mur\nsacré', targeting: 'enemy', cooldownMs: 16000,
    description: 'Bouclier + provoque la cible 3s + -25% dégâts subis, pendant 8s.',
    cast(character, target) {
      // Bouclier + provocation + réduction de dégâts (fusionnés) : le Paladin encaisse pendant
      // qu'il force l'ennemi à le cibler, quelle que soit la menace des autres (voir updateEnemyAI).
      const now = performance.now();
      const shield = 30 + Math.round(character.stats.force * 1.5);
      character.shieldHp = shield;
      character.shieldMax = shield;
      character.shieldExpiresAt = now + 8000;
      character.damageReductionFactor = 0.25;
      character.damageReductionUntil = now + 8000;
      addOwnActionThreat(character, 100, now);
      target.tauntedBy = character;
      target.tauntUntil = now + 3000;
    },
  },
  lumiereDivine: {
    id: 'lumiereDivine', name: 'Lumière divine', shortLabel: 'Lumière\ndivine', targeting: 'ally', cooldownMs: 8000,
    description: "Soigne l'allié le plus faible (10 + 28% Savoir + 12% Intelligence).",
    cast(character) {
      // Soin hybride Savoir + Intelligence (demande utilisateur explicite) : ~70/30, total proche
      // de l'ancienne version 100% Savoir pour un soigneur typique.
      const heal = 10 + Math.round(character.stats.savoir * 0.28 + character.stats.intelligence * 0.12);
      healCharacter(lowestHpAlly() || character, heal, character);
    },
  },

  // ============================== VOLEUR (Force, mêlée) ==============================
  // Multiplicateur dans le dos relevé de x2 à x2.5 (demande utilisateur explicite) : le Voleur
  // doit devenir le meilleur DPS mono-cible du jeu quand son positionnement est bon, pour que
  // jouer activement le placement (ou les alternatives qui l'imitent : Forme d'ombre, cible déjà
  // en saignement) soit un vrai choix payant plutôt qu'un bonus cosmétique.
  // Dégâts hybrides Force + Agilité (demande utilisateur explicite, voir computeHybridStatDamage) :
  // les % sont calibrés pour retomber sur un total proche de l'ancienne version 100% Force aux
  // stats de base du Voleur (12 Force, 20 Agilité), l'Agilité pesant pour ~40% du total.
  coupSournois: {
    id: 'coupSournois', name: 'Coup sournois', shortLabel: 'Coup\nsournois', targeting: 'enemy', cooldownMs: 6000,
    description: "72% Force + 29% Agilité, x2.5 dans le dos (ou via Forme d'ombre / cible en saignement).",
    cast(character, target) {
      const now = performance.now();
      const { amount, crit } = computeHybridStatDamage(character, 'force', 0.72, 'agilite', 0.288);
      // Dans le dos, ou garanti par Forme d'ombre (consommé une seule fois), ou si la cible
      // saigne déjà (Surinage/Fauchage) : dégâts x2.5.
      const guaranteed = (character.guaranteedBackstabUntil || 0) > now;
      const bleeding = (target.dotEffects || []).some((d) => d.kind === 'bleed');
      const damage = isBehind(character, target) || guaranteed || bleeding ? amount * 2.5 : amount;
      if (guaranteed) character.guaranteedBackstabUntil = 0;
      dealDamage(target, damage, '186, 104, 200', character, crit, 'Coup sournois');
    },
  },
  fauchage: {
    id: 'fauchage', name: 'Fauchage', shortLabel: 'Fauchage', targeting: 'enemy', cooldownMs: 10000,
    description: '36% Force + 14% Agilité à tous les ennemis + saignement (3 ticks).',
    cast(character) {
      for (const enemy of enemies) {
        if (enemy.hp <= 0) continue;
        const { amount, crit } = computeHybridStatDamage(character, 'force', 0.36, 'agilite', 0.144);
        if (dealDamage(enemy, amount, '186, 104, 200', character, crit, 'Fauchage')) {
          applyDot(enemy, {
            kind: 'bleed', ticksLeft: 3, tickIntervalMs: 800, rgb: '229, 57, 53', source: character,
            skillName: 'Fauchage (saignement)',
            damagePerTick: Math.round(character.stats.force * 0.06 + character.stats.agilite * 0.024),
          });
        }
      }
    },
  },
  formeDOmbre: {
    id: 'formeDOmbre', name: "Forme d'ombre", shortLabel: "Forme\nd'ombre", targeting: 'self', cooldownMs: 14000,
    description: "+25% esquive pendant 5s. La prochaine attaque compte comme dans le dos.",
    cast(character) {
      const now = performance.now();
      character.dodgeChance = 0.25;
      character.dodgeUntil = now + 5000;
      // La prochaine attaque après Forme d'ombre compte comme "dans le dos" (voir Coup sournois).
      character.guaranteedBackstabUntil = now + 5000;
    },
  },
  surinage: {
    id: 'surinage', name: 'Surinage', shortLabel: 'Surinage', targeting: 'enemy', cooldownMs: 8000,
    description: '42% Force + 17% Agilité + saignement plus long (4 ticks).',
    cast(character, target) {
      const { amount, crit } = computeHybridStatDamage(character, 'force', 0.42, 'agilite', 0.168);
      if (dealDamage(target, amount, '229, 57, 53', character, crit, 'Surinage')) {
        applyDot(target, {
          kind: 'bleed', ticksLeft: 4, tickIntervalMs: 800, rgb: '229, 57, 53', source: character,
          skillName: 'Surinage (saignement)',
          damagePerTick: Math.round(character.stats.force * 0.072 + character.stats.agilite * 0.0288),
        });
      }
    },
  },

  // ============================== MAGE (Intelligence, distance) -- glace uniquement ==============================
  eclatDeGlace: {
    id: 'eclatDeGlace', name: 'Éclat de glace', shortLabel: 'Éclat\nde glace', targeting: 'enemy', cooldownMs: 6000,
    description: '80% Intelligence. Ralentit la cible (déplacement et cadence d\'attaque) 2.5s.',
    cast(character, target) {
      const { amount, crit } = computeStatDamage(character, 'intelligence', 0.8);
      if (dealDamage(target, amount, '79, 195, 247', character, crit, 'Éclat de glace')) {
        const now = performance.now();
        target.slowMultiplier = 0.7;
        target.slowUntil = now + 2500;
        target.atkSlowMultiplier = 1.4; // cadence d'attaque ralentie
        target.atkSlowUntil = now + 2500;
      }
    },
  },
  novaDeGivre: {
    id: 'novaDeGivre', name: 'Nova de givre', shortLabel: 'Nova de\ngivre', targeting: 'enemy', cooldownMs: 10000,
    description: '50% Intelligence à tous les ennemis. Les ralentit 2.5s.',
    cast(character) {
      for (const enemy of enemies) {
        if (enemy.hp <= 0) continue;
        const { amount, crit } = computeStatDamage(character, 'intelligence', 0.5);
        if (dealDamage(enemy, amount, '79, 195, 247', character, crit, 'Nova de givre')) {
          enemy.slowMultiplier = 0.6;
          enemy.slowUntil = performance.now() + 2500;
        }
      }
    },
  },
  voileDeGivre: {
    id: 'voileDeGivre', name: 'Voile de givre', shortLabel: 'Voile de\ngivre', targeting: 'self', cooldownMs: 14000,
    description: 'Bouclier. Ralentit quiconque le frappe.',
    cast(character) {
      const shield = 15 + Math.round(character.stats.intelligence * 1.0);
      character.shieldHp = shield;
      character.shieldMax = shield;
      character.shieldExpiresAt = performance.now() + 6000;
      character.shieldReflectSlow = true;
    },
  },
  gel: {
    id: 'gel', name: 'Gel', shortLabel: 'Gel', targeting: 'enemy', cooldownMs: 16000,
    description: '20% Intelligence + ralentit, ou 30% + étourdit 2s si la cible est déjà ralentie.',
    cast(character, target) {
      const now = performance.now();
      const alreadySlowed = (target.slowUntil || 0) > now;
      if (alreadySlowed) {
        const { amount, crit } = computeStatDamage(character, 'intelligence', 0.3);
        dealDamage(target, amount, '129, 212, 250', character, crit, 'Gel');
        target.stunnedUntil = now + 2000; // immobilisation totale : ne bouge plus, n'attaque plus
      } else {
        const { amount, crit } = computeStatDamage(character, 'intelligence', 0.2);
        if (dealDamage(target, amount, '129, 212, 250', character, crit, 'Gel')) {
          target.slowMultiplier = 0.5;
          target.slowUntil = now + 2000;
        }
      }
    },
  },

  // ============================== PYROMANE (Intelligence, distance) -- feu uniquement ==============================
  // Profil revu (demande utilisateur explicite) : moins de dégâts directs, brûlure à stacks (voir
  // applyPyroBurnStack/updatePyroBurn plus haut) -- le Pyromane doit devenir le meilleur DPS sur
  // la durée, l'objectif de jeu étant de maintenir 3 stacks en continu plutôt que de détoner
  // systématiquement (voir Explosion, qui ne convertit plus que la moitié de la brûlure).
  bouleDeFeu: {
    id: 'bouleDeFeu', name: 'Boule de feu', shortLabel: 'Boule\nde feu', targeting: 'enemy', cooldownMs: 7000,
    description: "45% Intelligence. Pose 1 stack de brûlure (jusqu'à 3, entretenue si relancée).",
    cast(character, target) {
      const { amount, crit } = computeStatDamage(character, 'intelligence', 0.45);
      if (dealDamage(target, amount, '255, 112, 67', character, crit, 'Boule de feu')) {
        applyPyroBurnStack(target, character);
      }
    },
  },
  pluieDeFeu: {
    id: 'pluieDeFeu', name: 'Pluie de feu', shortLabel: 'Pluie de\nfeu', targeting: 'enemy', cooldownMs: 9000,
    description: '25% Intelligence à tous les ennemis. Pose 1 stack de brûlure sur chacun.',
    cast(character) {
      for (const enemy of enemies) {
        if (enemy.hp <= 0) continue;
        const { amount, crit } = computeStatDamage(character, 'intelligence', 0.25);
        if (dealDamage(enemy, amount, '255, 112, 67', character, crit, 'Pluie de feu')) {
          applyPyroBurnStack(enemy, character);
        }
      }
    },
  },
  bouclierDeFlammes: {
    id: 'bouclierDeFlammes', name: 'Bouclier de flammes', shortLabel: 'Bouclier\nflammes', targeting: 'self', cooldownMs: 14000,
    description: 'Bouclier. Brûle quiconque le frappe.',
    cast(character) {
      const shield = 15 + Math.round(character.stats.intelligence * 1.0);
      character.shieldHp = shield;
      character.shieldMax = shield;
      character.shieldExpiresAt = performance.now() + 6000;
      character.shieldReflectBurn = true;
    },
  },
  explosion: {
    id: 'explosion', name: 'Explosion', shortLabel: 'Explosion', targeting: 'enemy', cooldownMs: 12000,
    description: '30% Intelligence + détone 50% de la brûlure stockée (remet les stacks à 0).',
    cast(character, target) {
      // Détone les stacks de brûlure actifs pour un burst immédiat -- ne convertit plus que la
      // moitié de leur valeur (demande utilisateur explicite : détoner a un vrai coût
      // d'opportunité face à l'entretien des 3 stacks sur la durée, qui rapporte plus dans la
      // durée que le burst). Remet les stacks à 0 : il faut reconstruire après avoir détoné.
      const stacks = target.pyroBurnStacks || 0;
      const bankedTicks = 5; // valeur "type" d'entretien convertie, indépendante du minuteur d'expiration
      const consumed = stacks > 0
        ? Math.round((target.pyroBurnDamagePerTick || 0) * stacks * bankedTicks * 0.5)
        : 0;
      if (stacks > 0) target.pyroBurnStacks = 0;

      const { amount, crit } = computeStatDamage(character, 'intelligence', 0.3);
      dealDamage(target, amount + consumed, '255, 87, 34', character, crit, 'Explosion');
    },
  },

  // ============================== CHASSEUR (Force, distance) ==============================
  tirPercant: {
    id: 'tirPercant', name: 'Tir perçant', shortLabel: 'Tir\nperçant', targeting: 'enemy', cooldownMs: 5000,
    description: "90% Force. Jusqu'à +50% à longue portée, +15% si la cible est marquée.",
    cast(character, target) {
      const now = performance.now();
      const dist = Math.hypot(character.x - target.x, character.y - target.y);
      const distBonus = Math.min(0.5, dist / 440); // jusqu'à +50% à longue portée
      const markBonus = (target.huntersMarkUntil || 0) > now ? 0.15 : 0; // synergie avec Piège à ours
      const { amount, crit } = computeStatDamage(character, 'force', 0.9 * (1 + distBonus + markBonus));
      dealDamage(target, amount, '139, 195, 74', character, crit, 'Tir perçant');
    },
  },
  tirEnRafale: {
    id: 'tirEnRafale', name: 'Tir en rafale', shortLabel: 'Tir en\nrafale', targeting: 'enemy', cooldownMs: 10000,
    description: "Jusqu'à 3 tirs dégressifs (80/48/29% Force), chacun sur un ennemi différent.",
    cast(character) {
      // Vise jusqu'à 3 ennemis DIFFÉRENTS (dégressif à chaque tir) -- un rebond ne retombe jamais
      // sur une cible déjà touchée (demande utilisateur explicite) : avec un seul ennemi présent
      // (seul cas possible aujourd'hui, voir ENCOUNTERS), un seul tir part donc, les 2 autres ne
      // se produisent simplement pas plutôt que de retaper la même cible.
      const remaining = enemies.filter((e) => e.hp > 0);
      let mult = 0.8;
      for (let i = 0; i < 3 && remaining.length > 0; i++) {
        const idx = Math.floor(Math.random() * remaining.length);
        const shotTarget = remaining.splice(idx, 1)[0];
        const { amount, crit } = computeStatDamage(character, 'force', mult);
        dealDamage(shotTarget, amount, '139, 195, 74', character, crit, 'Tir en rafale');
        mult *= 0.6;
      }
    },
  },
  repliTactique: {
    id: 'repliTactique', name: 'Repli tactique', shortLabel: 'Repli\ntactique', targeting: 'self', cooldownMs: 14000,
    description: "Esquive totale 1s + recul loin de l'ennemi le plus proche.",
    cast(character) {
      const now = performance.now();
      character.dodgeChance = 1;
      character.dodgeUntil = now + 1000; // immunité brève
      const threat = nearestEnemyTo(character);
      if (threat) {
        const dist = Math.hypot(character.x - threat.x, character.y - threat.y) || 1;
        const dirX = (character.x - threat.x) / dist, dirY = (character.y - threat.y) / dist;
        startMove(character, character.x + dirX * 140, character.y + dirY * 140);
      }
    },
  },
  piegeAOurs: {
    id: 'piegeAOurs', name: 'Piège à ours', shortLabel: 'Piège\nà ours', targeting: 'enemy', cooldownMs: 8000,
    description: "70% Force, jusqu'à +60% à longue portée. Marque la cible 6s (bonus pour Tir perçant).",
    cast(character, target) {
      const dist = Math.hypot(character.x - target.x, character.y - target.y);
      const distBonus = Math.min(0.6, dist / 440);
      const { amount, crit } = computeStatDamage(character, 'force', 0.7 * (1 + distBonus));
      dealDamage(target, amount, '139, 195, 74', character, crit, 'Piège à ours');
      target.huntersMarkUntil = performance.now() + 6000; // marque : bonus pour Tir perçant ensuite
    },
  },

  // ============================== DRUIDE (Intelligence, distance) ==============================
  morsureVenimeuse: {
    id: 'morsureVenimeuse', name: 'Morsure venimeuse', shortLabel: 'Morsure\nvenim.', targeting: 'enemy', cooldownMs: 6000,
    description: '60% Intelligence + poison (4 ticks).',
    cast(character, target) {
      const { amount, crit } = computeStatDamage(character, 'intelligence', 0.6);
      if (dealDamage(target, amount, '124, 179, 66', character, crit, 'Morsure venimeuse')) {
        applyDot(target, {
          kind: 'poison', ticksLeft: 4, tickIntervalMs: 1000, rgb: '124, 179, 66', source: character,
          skillName: 'Morsure venimeuse (poison)', damagePerTick: Math.round(character.stats.intelligence * 0.12),
        });
      }
    },
  },
  // Soins hybrides Savoir + Intelligence (demande utilisateur explicite, ~70/30 -- voir Lumière
  // divine plus haut pour le détail du calibrage).
  epinesEmpoisonnees: {
    id: 'epinesEmpoisonnees', name: 'Épines empoisonnées', shortLabel: 'Épines\nempois.', targeting: 'enemy', cooldownMs: 10000,
    description: "Consomme le poison accumulé sur les ennemis pour soigner l'allié le plus faible.",
    cast(character) {
      // Consomme le poison accumulé sur tous les ennemis (voir applyDot/poisonStacks) pour
      // rendre des PV à l'allié le plus mal en point -- x2 par stack consommée.
      let stacksConsumed = 0;
      for (const enemy of enemies) {
        stacksConsumed += enemy.poisonStacks || 0;
        enemy.poisonStacks = 0;
      }
      if (stacksConsumed > 0) {
        const heal = stacksConsumed * 2 * Math.round(character.stats.savoir * 0.14 + character.stats.intelligence * 0.06);
        healCharacter(lowestHpAlly() || character, heal, character);
      }
    },
  },
  carapaceDEcorce: {
    id: 'carapaceDEcorce', name: "Carapace d'écorce", shortLabel: "Carapace\nd'écorce", targeting: 'ally', cooldownMs: 8000,
    description: "Bouclier + soin sur l'allié le plus faible.",
    cast(character) {
      const target = lowestHpAlly() || character;
      const shield = 10 + Math.round(character.stats.intelligence * 0.8);
      target.shieldHp = shield;
      target.shieldMax = shield;
      target.shieldExpiresAt = performance.now() + 6000;
      healCharacter(target, Math.round(character.stats.savoir * 0.21 + character.stats.intelligence * 0.09), character);
    },
  },
  chantDeLaForet: {
    id: 'chantDeLaForet', name: 'Chant de la forêt', shortLabel: 'Chant de\nla forêt', targeting: 'ally', cooldownMs: 14000,
    description: 'Soigne tout le groupe.',
    cast(character) {
      const heal = Math.round(character.stats.savoir * 0.28 + character.stats.intelligence * 0.12);
      for (const c of characters) {
        if (c.playerControlled && c.hp > 0) healCharacter(c, heal, character);
      }
    },
  },

  // ============================== PRÊTRE (Intelligence/Savoir, distance) ==============================
  // Gros soin mono-cible du jeu (demande utilisateur explicite) : Soin majeur pose un stack de
  // "Grâce" (jusqu'à PRIEST_GRACE_MAX) à chaque lancer, consommé par le PROCHAIN soin (ici Mot de
  // douleur, son soin de zone) pour un bonus cumulatif -- enchaîner Soin majeur avant de déclencher
  // Mot de douleur rentabilise l'attente. Mot de douleur rend aussi un peu de mana à qui il soigne.
  motDeDouleur: {
    id: 'motDeDouleur', name: 'Mot de douleur', shortLabel: 'Mot de\ndouleur', targeting: 'enemy', cooldownMs: 8000,
    description: '75% Intelligence + soigne tout le groupe (boosté par la Grâce) et rend un peu de mana.',
    cast(character, target) {
      // Dégâts +50% (demande utilisateur explicite) : le Prêtre restait très en retrait niveau
      // dégâts même après les cooldowns individualisés -- il ne sera jamais un vrai DPS, mais ne
      // doit pas non plus être totalement inoffensif.
      const { amount, crit } = computeStatDamage(character, 'intelligence', 0.75);
      if (dealDamage(target, amount, '245, 245, 245', character, crit, 'Mot de douleur')) {
        const graceStacks = character.priestGraceStacks || 0;
        character.priestGraceStacks = 0;
        const heal = Math.round(amount * 0.25 * (1 + graceStacks * 0.1));
        const manaRestore = Math.round(character.stats.savoir * 0.2);
        for (const c of characters) {
          if (!c.playerControlled || c.hp <= 0) continue;
          healCharacter(c, heal, character);
          if (manaRestore > 0) c.mana = Math.min(c.manaMax, c.mana + manaRestore);
        }
      }
    },
  },
  cercleSacre: {
    id: 'cercleSacre', name: 'Cercle sacré', shortLabel: 'Cercle\nsacré', targeting: 'self', cooldownMs: 12000,
    description: '-25% dégâts subis pour les alliés proches ; brûlure + ralentissement aux ennemis proches.',
    cast(character) {
      const now = performance.now();
      for (const ally of characters) {
        if (!ally.playerControlled || ally.hp <= 0) continue;
        if (Math.hypot(ally.x - character.x, ally.y - character.y) > ZONE_RADIUS) continue;
        ally.damageReductionFactor = 0.25;
        ally.damageReductionUntil = now + 4000;
      }
      for (const enemy of enemies) {
        if (enemy.hp <= 0) continue;
        if (Math.hypot(enemy.x - character.x, enemy.y - character.y) > ZONE_RADIUS) continue;
        applyDot(enemy, {
          kind: 'burn', ticksLeft: 3, tickIntervalMs: 1000, rgb: '245, 245, 245', source: character,
          skillName: 'Cercle sacré', damagePerTick: Math.round(character.stats.intelligence * 0.15), // +50%, voir Mot de douleur
        });
        enemy.slowMultiplier = 0.6;
        enemy.slowUntil = now + 3000;
      }
    },
  },
  voileProtecteur: {
    id: 'voileProtecteur', name: 'Voile protecteur', shortLabel: 'Voile\nprotecteur', targeting: 'self', cooldownMs: 10000,
    description: 'Bouclier sur soi.',
    cast(character) {
      const shield = 15 + Math.round(character.stats.savoir * 1.0);
      character.shieldHp = shield;
      character.shieldMax = shield;
      character.shieldExpiresAt = performance.now() + 6000;
    },
  },
  soinMajeur: {
    id: 'soinMajeur', name: 'Soin majeur', shortLabel: 'Soin\nmajeur', targeting: 'ally', cooldownMs: 5000,
    description: "Gros soin sur l'allié le plus faible (plus fort s'il vient d'être touché). Pose un stack de Grâce (jusqu'à 5) pour le prochain Mot de douleur.",
    cast(character) {
      const target = lowestHpAlly() || character;
      const recentlyHit = performance.now() - (target.lastDamageTakenAt || 0) <= 3000;
      // Soin hybride Savoir + Intelligence (demande utilisateur explicite, ~70/30).
      const power = character.stats.savoir * 0.7 + character.stats.intelligence * 0.3;
      const heal = Math.round(power * (recentlyHit ? 1.1 : 0.9));
      healCharacter(target, heal, character);
      // Pose un stack de Grâce (jusqu'à 5) consommé par le prochain Mot de douleur -- voir plus haut.
      character.priestGraceStacks = Math.min(5, (character.priestGraceStacks || 0) + 1);
    },
  },

  // ============================== SORCIER (Intelligence, distance) ==============================
  // Profil revu (demande utilisateur explicite) : le Sorcier doit être le meilleur DPS de zone du
  // jeu mais rester en retrait en mono-cible -- Drain de vie (son seul vrai dégât mono) affaibli,
  // Épidémie (sa zone) renforcée : poison plus fort, explosion plus grosse et se déclenchant plus
  // souvent (seuil abaissé).
  drainDeVie: {
    id: 'drainDeVie', name: 'Drain de vie', shortLabel: 'Drain de\nvie', targeting: 'enemy', cooldownMs: 6000,
    description: '50% Intelligence. Vous soigne de 50% des dégâts infligés.',
    cast(character, target) {
      const { amount, crit } = computeStatDamage(character, 'intelligence', 0.5);
      if (dealDamage(target, amount, '81, 45, 168', character, crit, 'Drain de vie')) {
        healCharacter(character, Math.round(amount * 0.5), character);
      }
    },
  },
  epidemie: {
    id: 'epidemie', name: 'Épidémie', shortLabel: 'Épidémie', targeting: 'enemy', cooldownMs: 10000,
    description: 'Empoisonne tous les ennemis. Explosion de zone si vos dégâts totaux dépassent un seuil (qui augmente ensuite).',
    cast(character) {
      for (const enemy of enemies) {
        if (enemy.hp <= 0) continue;
        applyDot(enemy, {
          kind: 'poison', ticksLeft: 4, tickIntervalMs: 1000, rgb: '81, 45, 168', source: character,
          skillName: 'Épidémie', damagePerTick: Math.round(character.stats.intelligence * 0.15),
        });
      }
      // Si le total infligé par le Sorcier ce combat dépasse le seuil, explosion de zone --
      // le seuil augmente ensuite pour la prochaine fois (voir combatStats, déjà suivi ailleurs).
      const dealtTotal = (combatStats[character.index] && combatStats[character.index].dealt.total) || 0;
      const threshold = character.epidemieNextThreshold || 150;
      if (dealtTotal >= threshold) {
        character.epidemieNextThreshold = threshold + 150;
        for (const enemy of enemies) {
          if (enemy.hp <= 0) continue;
          const { amount, crit } = computeStatDamage(character, 'intelligence', 1.25);
          dealDamage(enemy, amount, '81, 45, 168', character, crit, 'Épidémie (explosion)');
        }
      }
    },
  },
  pacteDeProtection: {
    id: 'pacteDeProtection', name: 'Pacte de protection', shortLabel: 'Pacte de\nprotection', targeting: 'self', cooldownMs: 14000,
    description: 'Bouclier. Renvoie les dégâts absorbés à son expiration.',
    cast(character) {
      const shield = 15 + Math.round(character.stats.intelligence * 1.0);
      character.shieldHp = shield;
      character.shieldMax = shield;
      character.shieldExpiresAt = performance.now() + 6000;
      character.shieldVengeful = true;
      character.shieldAbsorbedTotal = 0;
      character.lastShieldAttacker = null;
    },
  },
  malediction: {
    id: 'malediction', name: 'Malédiction', shortLabel: 'Malédic-\ntion', targeting: 'enemy', cooldownMs: 12000,
    description: '-20% dégâts infligés par la cible pendant 5s. Explosion de zone si elle meurt maudite.',
    cast(character, target) {
      const now = performance.now();
      target.damageOutputMultiplier = 0.8; // -20% dégâts infligés par la cible
      target.damageOutputUntil = now + 5000;
      target.cursedBy = character; // si la cible meurt maudite, explosion de zone (voir dealDamage)
    },
  },

  // ============================== CHAMAN (Intelligence, mêlée) ==============================
  // Couteau suisse (demande utilisateur explicite) : le plus mauvais DPS ET le plus mauvais
  // soigneur du jeu pris isolément (dégâts directs réduits ici, soin déjà le plus bas du roster),
  // compensé par un Totem qui devient un vrai gros bonus de zone (+20% dégâts et soin conséquent)
  // pour le groupe positionné dessus.
  frappeDesEsprits: {
    id: 'frappeDesEsprits', name: 'Frappe des esprits', shortLabel: 'Frappe\nesprits', targeting: 'enemy', cooldownMs: 6000,
    description: '70% Intelligence. +15% dégâts subis par la cible pendant 5s.',
    cast(character, target) {
      const { amount, crit } = computeStatDamage(character, 'intelligence', 0.7);
      if (dealDamage(target, amount, '236, 64, 122', character, crit, 'Frappe des esprits')) {
        target.damageTakenBonusFactor = 0.15;
        target.damageTakenBonusUntil = performance.now() + 5000;
      }
    },
  },
  chaineDEclairs: {
    id: 'chaineDEclairs', name: "Chaîne d'éclairs", shortLabel: "Chaîne\nd'éclairs", targeting: 'enemy', cooldownMs: 8000,
    description: "40% Intelligence. 2/3 de chance de rebondir (25%) sur un autre ennemi.",
    cast(character, target) {
      const { amount, crit } = computeStatDamage(character, 'intelligence', 0.4);
      dealDamage(target, amount, '255, 213, 79', character, crit, "Chaîne d'éclairs");
      if (Math.random() < 2 / 3) {
        // Rebondit UNIQUEMENT sur un autre ennemi vivant -- jamais sur la cible déjà touchée
        // (demande utilisateur explicite : un rebond n'est pas un deuxième coup sur la même
        // cible). S'il n'y a personne d'autre (seul cas possible aujourd'hui), le rebond ne se
        // produit tout simplement pas.
        const others = enemies.filter((e) => e !== target && e.hp > 0);
        if (others.length > 0) {
          const bounceTarget = others[Math.floor(Math.random() * others.length)];
          const { amount: amount2, crit: crit2 } = computeStatDamage(character, 'intelligence', 0.25);
          dealDamage(bounceTarget, amount2, '255, 213, 79', character, crit2, "Chaîne d'éclairs (rebond)");
        }
      }
    },
  },
  boucliersDesAncetres: {
    id: 'boucliersDesAncetres', name: 'Bouclier des ancêtres', shortLabel: 'Bouclier\nancêtres', targeting: 'self', cooldownMs: 12000,
    description: 'Bouclier + petit soin sur soi.',
    cast(character) {
      const shield = 15 + Math.round(character.stats.intelligence * 1.0);
      character.shieldHp = shield;
      character.shieldMax = shield;
      character.shieldExpiresAt = performance.now() + 6000;
      // Soin hybride Savoir + Intelligence (demande utilisateur explicite, ~70/30).
      healCharacter(character, Math.round(character.stats.savoir * 0.14 + character.stats.intelligence * 0.06), character);
    },
  },
  totem: {
    id: 'totem', name: 'Totem', shortLabel: 'Totem', targeting: 'ally', cooldownMs: 16000,
    description: '+20% dégâts et un soin pour le groupe resté à proximité, pendant 8s.',
    cast(character) {
      // Gros bonus de zone (demande utilisateur explicite : +20% dégâts et un vrai soin, pas un
      // petit bonus) mais seulement pour qui reste posté sur le totem (ZONE_RADIUS, comme Cercle
      // sacré) -- contrepartie du reste du kit volontairement faible, ça doit se mériter par le
      // positionnement plutôt que d'être un buff de groupe gratuit et permanent.
      // Le soin du Totem reste volontairement minime (le Chaman doit rester le plus mauvais
      // soigneur du roster, demande utilisateur explicite) : le "gros boost" est presque
      // entièrement porté par les dégâts (+20%), pas par le soin.
      const now = performance.now();
      // Soin hybride Savoir + Intelligence (demande utilisateur explicite, ~70/30).
      const heal = Math.round(character.stats.savoir * 0.105 + character.stats.intelligence * 0.045);
      for (const c of characters) {
        if (!c.playerControlled || c.hp <= 0) continue;
        if (Math.hypot(c.x - character.x, c.y - character.y) > ZONE_RADIUS) continue;
        healCharacter(c, heal, character);
        c.damageOutputMultiplier = 1.2;
        c.damageOutputUntil = now + 8000;
      }
    },
  },

  // ============================== GARDIEN (Force, mêlée) ==============================
  // Tank pur (demande utilisateur explicite) : Rempart (character.rempartStacks, 0-5) se pose et
  // se rafraîchit à chaque lancer -- l'entretenir en boucle le maintient à son plafond en continu,
  // même logique que la brûlure du Pyromane (voir GARDIEN_REMPART_DURATION_MS, plus long que le
  // cooldown de Rempart lui-même pour survivre à un cycle complet). Représailles transforme ces stacks en
  // dégâts réels ; Cri de défi est le taunt de zone demandé.
  coupDeBouclier: {
    id: 'coupDeBouclier', name: 'Coup de bouclier', shortLabel: 'Coup de\nbouclier', targeting: 'enemy', cooldownMs: 5000,
    description: "70% Force. Génère une menace bonus (le double des dégâts infligés).",
    cast(character, target) {
      const { amount, crit } = computeStatDamage(character, 'force', 0.7);
      if (dealDamage(target, amount, '84, 110, 122', character, crit, 'Coup de bouclier')) {
        addOwnActionThreat(character, amount, performance.now()); // menace doublée : dégâts + ce bonus
      }
    },
  },
  rempart: {
    id: 'rempart', name: 'Rempart', shortLabel: 'Rempart', targeting: 'self', cooldownMs: 6000,
    description: "Pose 1 stack de réduction de dégâts (jusqu'à 5, 5%/stack, jusqu'à -25%). Rafraîchit la durée à chaque lancer.",
    cast(character) {
      const now = performance.now();
      character.rempartStacks = Math.min(GARDIEN_REMPART_MAX_STACKS, (character.rempartStacks || 0) + 1);
      character.rempartExpiresAt = now + GARDIEN_REMPART_DURATION_MS;
      character.damageReductionFactor = character.rempartStacks * GARDIEN_REMPART_REDUCTION_PER_STACK;
      character.damageReductionUntil = character.rempartExpiresAt;
    },
  },
  criDeDefi: {
    id: 'criDeDefi', name: 'Cri de défi', shortLabel: 'Cri de\ndéfi', targeting: 'self', cooldownMs: 14000,
    description: 'Provoque tous les ennemis proches pendant 4s, avec une grosse menace sur chacun.',
    cast(character) {
      const now = performance.now();
      for (const enemy of enemies) {
        if (enemy.hp <= 0) continue;
        if (Math.hypot(enemy.x - character.x, enemy.y - character.y) > ZONE_RADIUS) continue;
        enemy.tauntedBy = character;
        enemy.tauntUntil = now + 4000;
        addOwnActionThreat(character, 100, now);
      }
    },
  },
  represailles: {
    id: 'represailles', name: 'Représailles', shortLabel: 'Représ-\nailles', targeting: 'enemy', cooldownMs: 8000,
    description: "60% Force + 10% par stack de Rempart actif (jusqu'à +50% à 5 stacks).",
    cast(character, target) {
      const stacks = character.rempartStacks || 0;
      const { amount, crit } = computeStatDamage(character, 'force', 0.6 + stacks * 0.1);
      dealDamage(target, amount, '84, 110, 122', character, crit, 'Représailles');
    },
  },
};

const CLASS_SKILLS = {
  Guerrier: ['frappeRageuse', 'tourbillon', 'postureDefensive', 'criDeRage'],
  Barbare: ['eventration', 'cercleDeSang', 'peauDePierre', 'frenesie'],
  Paladin: ['chatiment', 'vagueSacree', 'murSacre', 'lumiereDivine'],
  Voleur: ['coupSournois', 'fauchage', 'formeDOmbre', 'surinage'],
  Mage: ['eclatDeGlace', 'novaDeGivre', 'voileDeGivre', 'gel'],
  Pyromane: ['bouleDeFeu', 'pluieDeFeu', 'bouclierDeFlammes', 'explosion'],
  Chasseur: ['tirPercant', 'tirEnRafale', 'repliTactique', 'piegeAOurs'],
  Druide: ['morsureVenimeuse', 'epinesEmpoisonnees', 'carapaceDEcorce', 'chantDeLaForet'],
  'Prêtre': ['motDeDouleur', 'cercleSacre', 'voileProtecteur', 'soinMajeur'],
  Sorcier: ['drainDeVie', 'epidemie', 'pacteDeProtection', 'malediction'],
  Chaman: ['frappeDesEsprits', 'chaineDEclairs', 'boucliersDesAncetres', 'totem'],
  Gardien: ['coupDeBouclier', 'rempart', 'criDeDefi', 'represailles'],
};

// Même critère de "à portée" que l'attaque de base (voir updateCombat) : corps à corps = juste à
// côté, distance = dans RANGED_ATTACK_RANGE. Utilisé pour autoriser ou non un sort offensif --
// contrairement à un ordre d'attaque, lancer un sort ne fait pas marcher le personnage vers sa
// cible, il faut déjà être en position.
function isInRangeOf(character, target) {
  const combat = combatProfile(character);
  const dist = Math.hypot(character.x - target.x, character.y - target.y);
  return combat.melee ? dist <= avoidHalfExtent(character, target) + 20 : dist <= rangeFor(character) + 20;
}

// Coût en mana : le même pour tous les sorts (demande utilisateur explicite) -- contrairement aux
// cooldowns, restés uniques par sort ci-dessus (voir leur cooldownMs respectif). Abaissé de 20 à 10
// (demande utilisateur explicite) : avec des cooldowns bien plus courts qu'avant (3-20s au lieu de
// 20s fixe), le mana serait sinon devenu le vrai facteur limitant pour tout le monde. Régénération
// passive plus bas (voir updateManaRegen).
const SKILL_MANA_COST = 10;
const MANA_REGEN_PER_SEC = 2; // socle commun
const MANA_REGEN_PER_SAVOIR = 0.3; // + bonus selon le Savoir (les soigneurs récupèrent plus vite)

function updateManaRegen(character, dt) {
  if (!character.playerControlled || character.hp <= 0 || character.mana >= character.manaMax) return;
  const perSecond = MANA_REGEN_PER_SEC + (character.stats.savoir || 0) * MANA_REGEN_PER_SAVOIR;
  character.mana = Math.min(character.manaMax, character.mana + (perSecond * dt) / 1000);
}

// Renvoie true si le sort a réellement été lancé (utilisé par updateAutoPlay pour respecter le
// délai d'1s entre deux compétences de l'IA -- voir AUTO_ABILITY_INTERVAL_MS).
function castSkill(character, skillId) {
  if (character.hp <= 0 || combatPhase === 'prePull') return false; // mort, ou pull pas encore lancé
  const skill = SKILLS[skillId];
  if (!skill) return false;

  const now = performance.now();
  const readyAt = (character.cooldowns && character.cooldowns[skillId]) || 0;
  if (now < readyAt) return false;
  if ((character.mana || 0) < SKILL_MANA_COST) return false;

  if (skill.targeting === 'enemy') {
    // Respecte la cible déjà choisie à l'attaque de base (voir orderAttack/updateCombat) --
    // permet de viser la bombe volante de l'Artificier gobelin avec un sort, pas seulement
    // l'ennemi principal (demande utilisateur explicite). Repli sur l'ennemi principal si rien
    // n'a encore été ciblé manuellement, comme avant.
    const target = character.attackTarget || enemies[0];
    if (!target || target.hp <= 0 || !isInRangeOf(character, target)) return false;
    skill.cast(character, target);
  } else {
    skill.cast(character);
  }

  character.mana -= SKILL_MANA_COST;
  if (!character.cooldowns) character.cooldowns = {};
  character.cooldowns[skillId] = now + skill.cooldownMs;
  return true;
}

// Avance le personnage d'au plus PIXELS_PER_MS * dt le long de son chemin restant. Base sur un
// pas de temps (dt) plutôt que sur le temps écoulé depuis le départ : la position réelle (donc
// d'éventuelles corrections de resolveOverlaps ci-dessous) sert de point de départ à chaque
// image, au lieu d'être recalculée du début à chaque fois -- indispensable pour que l'évitement
// entre deux personnages qui se déplacent en même temps (voir resolveOverlaps) reste effectif
// d'une image à l'autre plutôt que d'être écrasé.
function updateMove(character, dt) {
  if (character.hp <= 0) {
    character.isMoving = false; // mort en cours de route : s'arrête net, ne termine pas son trajet
    return;
  }
  if (!character.isMoving) return;

  const now = performance.now();
  // Étourdi (Gel du Mage) : ne bouge plus du tout tant que ça dure.
  if ((character.stunnedUntil || 0) > now) return;
  // Ralenti (Trait de givre/Éclat de glace) : vitesse de déplacement réduite.
  let speedMultiplier = (character.slowUntil || 0) > now ? (character.slowMultiplier || 1) : 1;
  // Charge de bombe du Gobelin (voir updateBombAttack) : déplacement temporairement accéléré pour
  // rendre le geste "rapide" (demande utilisateur explicite).
  if ((character.bombDashUntil || 0) > now) speedMultiplier *= BOMB_DASH_SPEED_MULTIPLIER;
  let remaining = PIXELS_PER_MS * speedMultiplier * dt;

  while (remaining > 0 && character.pathPoints.length > 0) {
    const target = character.pathPoints[0];
    const dx = target.x - character.x, dy = target.y - character.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= remaining) {
      character.x = target.x;
      character.y = target.y;
      remaining -= dist;
      character.pathPoints.shift();
    } else {
      character.x += (dx / dist) * remaining;
      character.y += (dy / dist) * remaining;
      remaining = 0;
    }
  }

  if (character.pathPoints.length === 0) character.isMoving = false;
}

// Filet de sécurité exécuté après le déplacement de tous les personnages à chaque image : le
// chemin de chacun est calculé par rapport aux positions des autres AU MOMENT du drag, donc si
// deux personnages se déplacent en même temps leurs trajets peuvent quand même se croiser. Ici
// on écarte simplement toute paire qui se chevauche encore, des deux côtés à parts égales -- ça
// ne remplace pas l'évitement de trajet (qui donne un contournement "propre"), mais garantit
// qu'un chevauchement ne peut jamais durer, quelle que soit la façon dont les trajets interagissent.
function resolveOverlaps() {
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < characters.length; i++) {
      for (let j = i + 1; j < characters.length; j++) {
        const a = characters[i], b = characters[j];
        if (canPassThrough(a, b)) continue; // boss <-> joueurs : se traversent librement en chemin
        const half = (a.size + b.size) / 2;
        const dx = a.x - b.x, dy = a.y - b.y;
        if (Math.abs(dx) >= half || Math.abs(dy) >= half) continue;

        const overlapX = half - Math.abs(dx);
        const overlapY = half - Math.abs(dy);
        if (overlapX < overlapY) {
          const shift = (overlapX / 2) * (dx < 0 ? -1 : 1);
          a.x += shift;
          b.x -= shift;
        } else {
          const shift = (overlapY / 2) * (dy < 0 ? -1 : 1);
          a.y += shift;
          b.y -= shift;
        }
      }
    }
  }

  // Garantit qu'aucun personnage ne se retrouve hors du terrain, même repoussé hors champ par
  // l'écartement ci-dessus près d'un bord d'écran.
  for (const c of characters) {
    const p = clampPointToField(c, c.x, c.y);
    c.x = p.x;
    c.y = p.y;
  }
}

// Ramène (x, y) à l'intérieur du terrain (canvas, sous le bandeau de navigation du haut) de
// façon à ce que le personnage n'en dépasse jamais, quel que soit le point demandé (bord
// d'écran, marge d'évitement qui pousserait dehors...).
function clampPointToField(character, x, y) {
  const half = character.size / 2;
  let minY = TOP_BANNER_HEIGHT + half;
  // Avant l'appui sur "Pull" : un personnage du joueur reste cantonné aux 2 tiers du bas.
  if (character.playerControlled && combatPhase === 'prePull') {
    minY = Math.max(minY, prePullMinY());
  }
  const maxX = Math.max(canvas.width - half, half);
  const maxY = Math.max(canvas.height - half, minY);
  return {
    x: Math.min(Math.max(x, half), maxX),
    y: Math.min(Math.max(y, minY), maxY),
  };
}

function isInsideCharacter(character, x, y) {
  const half = character.size / 2;
  return (
    x >= character.x - half && x <= character.x + half &&
    y >= character.y - half && y <= character.y + half
  );
}

function otherCharacters(character) {
  return characters.filter((c) => c !== character);
}

// Le boss et les personnages du joueur s'ignorent EN CHEMIN (peuvent se croiser/chevaucher
// pendant un déplacement, ni contournement de trajet ni écartement en temps réel), mais aucun
// des deux ne peut pour autant finir son déplacement à l'arrêt sur l'autre -- resolveDestination
// (qui protège le point d'arrivée) s'applique lui à tout le monde, voir plus bas.
function canPassThrough(a, b) {
  return a.playerControlled !== b.playerControlled;
}

// Obstacles à éviter EN CHEMIN pour "character" (contournement de trajet + écartement en temps
// réel) : tous les autres personnages sauf ceux qu'il traverse librement (voir canPassThrough).
function pathObstacles(character) {
  return otherCharacters(character).filter((obs) => !canPassThrough(character, obs));
}

// Demi-largeur du rectangle d'évitement autour de "obs" pour un personnage "character" : la
// somme de leurs deux demi-tailles (+ marge), soit exactement la zone dans laquelle leurs carrés
// se chevaucheraient si "character" avait son centre dedans.
function avoidHalfExtent(character, obs) {
  return (character.size + obs.size) / 2 + AVOID_MARGIN;
}

function isInsideBox(px, py, ox, oy, half) {
  return Math.abs(px - ox) < half && Math.abs(py - oy) < half;
}

// Point le plus proche de (px, py), à l'intérieur du rectangle centré en (ox, oy), sur le bord
// de ce rectangle -- en poussant selon l'axe où (px, py) en est le plus proche (le plus petit
// déplacement possible pour sortir du rectangle).
function pushOutOfBox(px, py, ox, oy, half) {
  const dx = px - ox, dy = py - oy;
  const distLeft = half + dx;
  const distRight = half - dx;
  const distTop = half + dy;
  const distBottom = half - dy;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);
  if (minDist === distLeft) return { x: ox - half, y: py };
  if (minDist === distRight) return { x: ox + half, y: py };
  if (minDist === distTop) return { x: px, y: oy - half };
  return { x: px, y: oy + half };
}

// Si (x, y) tombe dans le rectangle d'évitement d'un autre personnage, ramène le point au bord
// de ce rectangle (répété pour converger si plusieurs obstacles sont proches). Le point est
// aussi ramené à l'intérieur du terrain : sans ça, un point de relâche près du bord de l'écran
// (ou repoussé vers ce bord par l'évitement d'un obstacle) laisserait le personnage à moitié
// hors champ.
function resolveDestination(character, x, y) {
  let { x: px, y: py } = clampPointToField(character, x, y);
  const obstacles = otherCharacters(character);
  for (let iter = 0; iter < 6; iter++) {
    let adjusted = false;
    for (const obs of obstacles) {
      const half = avoidHalfExtent(character, obs);
      if (isInsideBox(px, py, obs.x, obs.y, half)) {
        const p = pushOutOfBox(px, py, obs.x, obs.y, half);
        px = p.x;
        py = p.y;
        adjusted = true;
      }
    }
    if (!adjusted) break;
  }
  return clampPointToField(character, px, py);
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const abLenSq = abx * abx + aby * aby;
  let t = abLenSq > 1e-9 ? ((px - ax) * abx + (py - ay) * aby) / abLenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + abx * t, y: ay + aby * t };
}

// Si le segment [A,B] traverse le rectangle d'évitement de l'obstacle, renvoie un point de
// détour (sur le bord de ce rectangle) à insérer entre A et B.
function detourAroundObstacle(ax, ay, bx, by, ox, oy, half) {
  const cp = closestPointOnSegment(ox, oy, ax, ay, bx, by);
  if (!isInsideBox(cp.x, cp.y, ox, oy, half)) return null;
  return pushOutOfBox(cp.x, cp.y, ox, oy, half);
}

// Construit le chemin de (sx, sy) à (dx, dy) en insérant des détours autour des autres
// personnages que le trajet traverserait. Renvoie la liste des points à atteindre (sans le
// point de départ).
function computeAvoidancePath(character, sx, sy, dx, dy) {
  const points = [{ x: sx, y: sy }, { x: dx, y: dy }];
  const obstacles = pathObstacles(character);

  for (let pass = 0; pass < 6; pass++) {
    let inserted = false;
    for (let i = 0; i < points.length - 1 && !inserted; i++) {
      for (const obs of obstacles) {
        const half = avoidHalfExtent(character, obs);
        const wp = detourAroundObstacle(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, obs.x, obs.y, half);
        if (wp) {
          points.splice(i + 1, 0, clampPointToField(character, wp.x, wp.y));
          inserted = true;
          break;
        }
      }
    }
    if (!inserted) break;
  }

  return points.slice(1);
}

// Distinction clic / drag : un pointeur relâché près de son point de départ est un clic
// (sélection), sinon c'est un drag (déplacement vers le point de relâchement).
const CLICK_THRESHOLD = 8;
let pointerId = null;
let pointerActive = false; // un pointeur est en cours de suivi (sur un personnage ou dans le vide)
let activeTarget = null; // personnage concerné par le pointeur en cours, null si pression dans le vide
let pointerDownX = 0, pointerDownY = 0;
let dragging = false;
let dragPreviewPath = [];
let dragTargetEnemy = null; // ennemi survolé pendant le drag -- voir pointermove
let pressedEnemy = null; // ennemi sous le doigt au pointerdown (hors personnage), voir pointerup
let threatPanelEnemy = null; // ennemi dont on affiche l'ordre de menace (clic dessus), voir drawThreatPanel

// Appui long (tactile) sur une case survolable (ex. "Compétences", voir hoverRects) : équivalent
// tactile du survol souris (demande utilisateur explicite -- un doigt ne "survole" jamais sans
// contact, donc on affiche le détail tant que le doigt reste posé dessus, plutôt qu'au survol).
const LONG_PRESS_MS = 350;
let longPressTimer = null;

function clearLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

// ------------------------------------------------------------------
// Défilement vertical générique, par scène (demande utilisateur explicite : Personnage d'abord,
// puis le même problème sur Guilde -- 12 personnages ne tiennent pas plus dans l'onglet Guilde que
// dans Personnage, voir drawGuildeRosterTab). Le jeu n'a pas de défilement natif ailleurs, donc les
// cases (registerHitRect) ne peuvent plus se déclencher directement au pointerdown comme avant --
// sinon un simple geste de défilement démarré sur une case l'ouvrait/fermait au lieu de faire
// défiler. Elles ne se déclenchent donc plus qu'au relâchement, et seulement si le déplacement
// total est resté sous CLICK_THRESHOLD. Chaque scène listée ici a son propre décalage/hauteur
// (measurée à chaque image par la fonction de dessin de cette scène), pour ne pas se marcher
// dessus en changeant d'onglet.
// ------------------------------------------------------------------
const SCROLLABLE_SCENES = new Set(['personnage', 'guilde', 'joueur']);
const sceneScrollY = {}; // { [scene]: décalage actuel }
const sceneContentHeight = {}; // { [scene]: hauteur mesurée à la dernière image }

function getSceneScrollY(scene) {
  return sceneScrollY[scene] || 0;
}

function sceneMaxScroll(scene) {
  const viewportHeight = canvas.height - (TOP_BANNER_HEIGHT + 16);
  return Math.max(0, (sceneContentHeight[scene] || 0) - viewportHeight);
}

function clampSceneScroll(scene, value) {
  return Math.max(0, Math.min(sceneMaxScroll(scene), value));
}

// Appelé par la fonction de dessin d'une scène défilable une fois son contenu entièrement mesuré
// (hauteur totale non tronquée) : borne le décalage courant à ce qui est maintenant valide (utile
// si le contenu vient de rétrécir, ex. une ligne repliée) et renvoie le décalage à utiliser pour
// CETTE image.
function setSceneContentHeight(scene, height) {
  sceneContentHeight[scene] = height;
  sceneScrollY[scene] = clampSceneScroll(scene, sceneScrollY[scene] || 0);
  return sceneScrollY[scene];
}

let pendingHit = null; // case en attente de relâchement (voir plus haut), annulée si ça devient un défilement
let pendingHitStartX = 0, pendingHitStartY = 0;
let scrollDragActive = false;
let scrollDragStartY = 0;
let scrollDragStartOffset = 0;
let scrollDragScene = null; // scène concernée par le défilement en cours (voir pointerdown)

function getPointerPos(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

// Un bouton par scène, répartis sur toute la largeur du bandeau du haut.
function sceneButtonRects() {
  const buttonWidth = canvas.width / SCENES.length;
  return SCENES.map((scene, i) => ({
    scene: scene.key,
    label: scene.label,
    x: i * buttonWidth,
    y: 0,
    width: buttonWidth,
    height: TOP_BANNER_HEIGHT,
  }));
}

function hitTestSceneButton(x, y) {
  if (y > TOP_BANNER_HEIGHT) return null;
  for (const rect of sceneButtonRects()) {
    if (x >= rect.x && x < rect.x + rect.width) return rect.scene;
  }
  return null;
}

// L'adversaire (playerControlled: false) n'est ni sélectionnable ni déplaçable par le joueur ;
// un personnage mort (0 PV) non plus -- voir la croix rouge dans drawCharacter.
function hitTestCharacter(x, y) {
  for (let i = characters.length - 1; i >= 0; i--) {
    const c = characters[i];
    if (c.playerControlled && c.hp > 0 && isInsideCharacter(c, x, y)) return c;
  }
  return null;
}

function deselectAll() {
  for (const c of characters) c.selected = false;
}

// Termine le suivi du pointeur en cours, quoi qu'il arrive (relâché normalement, annulé,
// application mise en arrière-plan...) -- volontairement pas conditionné à la correspondance de
// pointerId : un identifiant de pointeur qui change entre pointerdown/pointerup (déjà observé
// sur certains WebView Android) laissait sinon le trait/rond de prévisualisation affiché en
// permanence, plus aucun événement ne pouvant jamais l'effacer.
function clearPointerState() {
  pointerId = null;
  pointerActive = false;
  activeTarget = null;
  pressedEnemy = null;
  dragging = false;
  dragPreviewPath = [];
  dragTargetEnemy = null;
  clearLongPress();
  hoveredSkillsCharacter = null;
  pendingHit = null;
  scrollDragActive = false;
}

canvas.addEventListener('pointerdown', (event) => {
  const { x, y } = getPointerPos(event);

  // Bandeau de navigation : change de scène immédiatement, sans passer par la logique de
  // sélection/drag des personnages ci-dessous (pointerActive reste false, donc le pointerup
  // correspondant ne fera rien).
  const sceneButton = hitTestSceneButton(x, y);
  if (sceneButton) {
    currentScene = sceneButton;
    return;
  }

  // Scène à défilement (voir SCROLLABLE_SCENES) : tout appui y démarre un suivi de défilement
  // potentiel, même s'il tombe aussi sur une case (voir pendingHit ci-dessous) -- c'est le
  // pointermove qui décidera si le geste est un défilement (déplacement franc) ou un tap.
  if (SCROLLABLE_SCENES.has(currentScene)) {
    scrollDragActive = true;
    scrollDragScene = currentScene;
    scrollDragStartY = y;
    scrollDragStartOffset = getSceneScrollY(currentScene);
  }

  // Zones interactives de la scène affichée (jauges de compétence du joueur, cases de sort du
  // bandeau de sélection en combat, ligne de personnage à déplier...) : prioritaires sur la
  // sélection/déplacement de combat ci-dessous. Ne se déclenchent qu'au relâchement (voir
  // pointerup) -- sinon un défilement démarré dessus serait interprété comme un tap (bug corrigé,
  // demande utilisateur explicite : impossible de défiler l'onglet Personnage avant ce correctif).
  const hit = hitTestInteractiveRects(x, y);
  if (hit) {
    pendingHit = hit;
    pendingHitStartX = x;
    pendingHitStartY = y;
    return;
  }

  // Appui (tactile ou souris) sur une case survolable : démarre le minuteur d'appui long --
  // voir clearLongPress (pointerup/pointercancel/pointerleave) et le pointermove de survol
  // ci-dessous (souris uniquement, ignoré ici pour éviter d'afficher deux fois).
  const hoverHit = hitTestHoverRects(x, y);
  if (hoverHit) {
    clearLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      hoveredSkillsCharacter = hoverHit;
    }, LONG_PRESS_MS);
    return;
  }

  // Hors de la scène "combat", il n'y a pas de personnages à sélectionner/déplacer -- et une fois
  // le combat terminé (écran de victoire/défaite), plus aucune interaction avec le champ de
  // bataille figé en dessous, seuls les boutons de l'écran de fin (déjà gérés ci-dessus) réagissent.
  if (currentScene !== 'combat' || combatPhase === 'victory' || combatPhase === 'defeat') return;

  pointerId = event.pointerId;
  pointerActive = true;
  activeTarget = hitTestCharacter(x, y);
  // Un ennemi cliqué (pas un drag) affiche son ordre de menace -- voir pointerup.
  pressedEnemy = activeTarget ? null : hitTestEnemyAt(x, y);
  pointerDownX = x;
  pointerDownY = y;
  dragging = false;
  dragPreviewPath = [];
  dragTargetEnemy = null;
  canvas.setPointerCapture(pointerId);
});

// Défilement (voir SCROLLABLE_SCENES) + annulation du tap/appui long en attente dès que le geste
// s'avère être un vrai déplacement plutôt qu'un tap sur place (voir pointerdown/pointerup).
canvas.addEventListener('pointermove', (event) => {
  if (!scrollDragActive && !pendingHit && !longPressTimer) return;
  const { x, y } = getPointerPos(event);

  if (scrollDragActive) {
    const delta = y - scrollDragStartY;
    if (Math.abs(delta) > CLICK_THRESHOLD) {
      sceneScrollY[scrollDragScene] = clampSceneScroll(scrollDragScene, scrollDragStartOffset - delta);
      // Un vrai défilement n'est plus un tap ni un appui long -- annule les deux.
      pendingHit = null;
      clearLongPress();
      hoveredSkillsCharacter = null;
    }
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (!pointerActive || !activeTarget) return;
  const { x, y } = getPointerPos(event);
  dragging = Math.hypot(x - pointerDownX, y - pointerDownY) > CLICK_THRESHOLD;
  if (!dragging) return;

  // Survoler un ennemi pendant le drag : indique la cible (voir draw()) au lieu du trajet de
  // déplacement habituel -- sans ça, resolveDestination repousse toujours l'aperçu en dehors de
  // l'ennemi, donnant l'impression à tort qu'on ne peut pas viser dessus. Avant le pull, aucune
  // attaque n'est possible : jamais de mise en avant de cible, juste l'aperçu de déplacement.
  dragTargetEnemy = combatPhase === 'prePull' ? null : hitTestEnemyAt(x, y);
  if (dragTargetEnemy) {
    dragPreviewPath = [];
    return;
  }

  const dest = resolveDestination(activeTarget, x, y);
  dragPreviewPath = computeAvoidancePath(activeTarget, activeTarget.x, activeTarget.y, dest.x, dest.y);
});

// Survol (souris/web) indépendant du drag ci-dessus -- toujours actif, pas seulement pendant un
// appui (voir hoverRects/registerHoverRect). Explicitement ignoré sur tactile (pointerType
// 'touch') : le doigt utilise l'appui long géré dans pointerdown/pointerup à la place.
canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'touch') return;
  const { x, y } = getPointerPos(event);
  hoveredSkillsCharacter = hitTestHoverRects(x, y);
});

canvas.addEventListener('pointerup', (event) => {
  // Relâche l'appui long en cours (voir pointerdown) et masque la bulle de détail affichée --
  // indépendant de pointerActive, qui n'est jamais mis à true pour un appui sur une case
  // survolable (voir le retour anticipé dans pointerdown).
  clearLongPress();
  hoveredSkillsCharacter = null;
  scrollDragActive = false;

  // Case en attente (voir pointerdown/hitTestInteractiveRects) : ne se déclenche que si le
  // relâchement reste proche du point d'appui -- un vrai déplacement (défilement) l'a déjà
  // annulée entre-temps (voir le pointermove de défilement), donc pendingHit serait déjà null.
  if (pendingHit) {
    const { x: upX, y: upY } = getPointerPos(event);
    const hitDist = Math.hypot(upX - pendingHitStartX, upY - pendingHitStartY);
    const action = pendingHit;
    pendingHit = null;
    if (hitDist <= CLICK_THRESHOLD) action.onClick();
    return;
  }

  if (!pointerActive) return;
  const { x, y } = getPointerPos(event);
  const dist = Math.hypot(x - pointerDownX, y - pointerDownY);

  if (activeTarget) {
    if (dist <= CLICK_THRESHOLD) {
      // Sélectionner un personnage désélectionne automatiquement les autres (un seul
      // sélectionné à la fois) ; cliquer sur le seul personnage déjà sélectionné le désélectionne.
      const wasSelected = activeTarget.selected;
      deselectAll();
      activeTarget.selected = !wasSelected;
    } else {
      // Démarrer un drag depuis un personnage le sélectionne aussi, même s'il ne l'était pas.
      deselectAll();
      activeTarget.selected = true;

      // Terminer le drag SUR un ennemi = ordre d'attaque plutôt qu'un simple déplacement --
      // sauf avant le pull, où aucune attaque n'est permise (voir combatPhase).
      const targetEnemy = combatPhase === 'prePull' ? null : hitTestEnemyAt(x, y);
      if (targetEnemy) {
        orderAttack(activeTarget, targetEnemy);
      } else {
        activeTarget.attackTarget = null; // un nouvel ordre de déplacement annule un combat en cours
        startMove(activeTarget, x, y);
      }
    }
  } else if (pressedEnemy && dist <= CLICK_THRESHOLD) {
    // Clic sur un ennemi (pas un drag) : affiche/masque son ordre de menace -- un deuxième clic
    // sur le même ennemi referme le panneau.
    threatPanelEnemy = threatPanelEnemy === pressedEnemy ? null : pressedEnemy;
  } else if (dist <= CLICK_THRESHOLD) {
    deselectAll(); // clic dans le vide : désélectionne tout
    threatPanelEnemy = null;
  }

  clearPointerState();
});

canvas.addEventListener('pointercancel', clearPointerState);
canvas.addEventListener('pointerleave', () => { clearLongPress(); hoveredSkillsCharacter = null; });
// Filet de sécurité : si l'app passe en arrière-plan (changement d'app, verrouillage...) pendant
// un drag, on ne reçoit pas forcément de pointerup/pointercancel propre.
window.addEventListener('blur', clearPointerState);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearPointerState();
});

// Bombe télégraphiée avant explosion (voir updateBombAttack/updateBombs) : zone de dégâts fixe en
// fond + anneau qui se referme au fil de la mèche, pour prévenir juste avant que ça explose.
// Dessinée avant les personnages (voir draw()) pour rester "au sol", sous leurs pieds.
function drawBomb(bomb, now) {
  const progress = Math.min(1, (now - bomb.plantedAt) / (bomb.explodeAt - bomb.plantedAt));

  ctx.save();
  ctx.beginPath();
  ctx.arc(bomb.x, bomb.y, BOMB_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${BOMB_COLOR_RGB}, 0.14)`;
  ctx.fill();
  ctx.strokeStyle = `rgba(${BOMB_COLOR_RGB}, 0.7)`;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(bomb.x, bomb.y, BOMB_RADIUS * (1 - progress), 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${BOMB_ACCENT_RGB}, 0.9)`;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '26px sans-serif';
  ctx.fillText('💣', bomb.x, bomb.y);
}

// Bombe volante de l'Artificier gobelin (voir launchFlyingBomb/updateFlyingBombs) : icône +
// traînée dans le sens du déplacement + barre de PV (réutilise drawEnemyHealthBar, compatible
// puisque la bombe porte les mêmes champs x/y/size/hp/hpMax) pour montrer qu'elle est
// attaquable/destructible en vol.
function drawFlyingBomb(bomb) {
  // vx/vy encodent maintenant une vraie vitesse (px/ms, voir launchFlyingBomb), plus un simple
  // vecteur unitaire -- normalisé ici pour garder une traînée de longueur fixe à l'écran.
  const speed = Math.hypot(bomb.vx, bomb.vy) || 1;
  const dirX = bomb.vx / speed, dirY = bomb.vy / speed;

  ctx.save();
  ctx.strokeStyle = `rgba(${FLYING_BOMB_COLOR_RGB}, 0.55)`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bomb.x - dirX * 28, bomb.y - dirY * 28);
  ctx.lineTo(bomb.x, bomb.y);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(bomb.size)}px sans-serif`;
  ctx.fillText('💣', bomb.x, bomb.y);

  drawEnemyHealthBar(bomb);
}

// Zone de proximité de l'Artificier gobelin (voir updateFlyingBombAttack, demande utilisateur
// explicite : "zone à tracer autour de lui") -- affichée en permanence pendant le combat (pas
// seulement au moment du décompte) pour que le joueur puisse anticiper et s'en écarter avant le
// palier des 4s. Distincte visuellement des zones de dégâts des bombes (bleu, pas rouge : ce n'est
// pas une zone qui blesse, juste une zone qui ralentit le prochain tir).
function drawArtificierProximityZone(enemy) {
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = 'rgba(79, 195, 247, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(enemy.x, enemy.y, ARTIFICIER_PROXIMITY_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawCharacter(character) {
  const half = character.size / 2;
  if (character.selected) {
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 4;
    ctx.strokeRect(character.x - half - 6, character.y - half - 6, character.size + 12, character.size + 12);
  }
  const dead = character.hp <= 0;
  const sprite = CLASS_SPRITES[character.className];
  const spriteReady = !dead && sprite && sprite.complete && sprite.naturalWidth;
  if (spriteReady) {
    // Mis à l'échelle pour tenir dans le carré (proportions conservées, pas déformé) -- même
    // emprise que le carré uni, pour ne rien décaler (barre de PV, badges de statut...).
    const scale = Math.min(character.size / sprite.naturalWidth, character.size / sprite.naturalHeight);
    const dw = sprite.naturalWidth * scale, dh = sprite.naturalHeight * scale;
    ctx.drawImage(sprite, character.x - dw / 2, character.y - dh / 2, dw, dh);
  } else {
    ctx.fillStyle = dead ? '#4a4a4a' : character.color;
    ctx.fillRect(character.x - half, character.y - half, character.size, character.size);
  }

  // Bouclier actif (Mur sacré) : fin liseré bleuté autour du personnage tant qu'il tient.
  if (!dead && character.shieldHp > 0) {
    ctx.strokeStyle = '#80d8ffcc';
    ctx.lineWidth = 3;
    ctx.strokeRect(character.x - half - 3, character.y - half - 3, character.size + 6, character.size + 6);
  }

  // Forme d'ombre (Voleur) : liseré violet pointillé tant que l'esquive est active.
  const now = performance.now();
  if (!dead && (character.dodgeUntil || 0) > now) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#ba68c8cc';
    ctx.lineWidth = 3;
    ctx.strokeRect(character.x - half - 3, character.y - half - 3, character.size + 6, character.size + 6);
    ctx.restore();
  }

  // Déphasage (Mage) : double liseré blanc tant que le personnage est insensible à tout (et ne
  // peut plus infliger de dégâts, voir dealDamage).
  if (!dead && (character.phaseUntil || 0) > now) {
    ctx.strokeStyle = '#ffffffaa';
    ctx.lineWidth = 2;
    ctx.strokeRect(character.x - half - 5, character.y - half - 5, character.size + 10, character.size + 10);
  }

  if (dead) {
    // Croix rouge par-dessus le carré : mort, ne peut plus être déplacé ni ciblé (voir
    // hitTestCharacter/hitTestEnemyAt et les gardes en tête de updateMove/updateCombat/updateAutoPlay).
    const inset = character.size * 0.15;
    ctx.strokeStyle = '#ff1744';
    ctx.lineWidth = Math.max(3, character.size * 0.09);
    ctx.beginPath();
    ctx.moveTo(character.x - half + inset, character.y - half + inset);
    ctx.lineTo(character.x + half - inset, character.y + half - inset);
    ctx.moveTo(character.x + half - inset, character.y - half + inset);
    ctx.lineTo(character.x - half + inset, character.y + half - inset);
    ctx.stroke();
  } else if (character.label && !spriteReady) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(character.size * 0.5)}px sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.strokeText(character.label, character.x, character.y + 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(character.label, character.x, character.y + 1);
  }
}

// PV puis mana, sous le personnage -- toujours visibles (contrairement au détail complet du
// bandeau de sélection, qui lui n'apparaît que pour le personnage sélectionné).
function drawCharacterBars(character) {
  if (character.hp <= 0) return; // rien à montrer sur un cadavre (déjà la croix rouge)
  const half = character.size / 2;
  const barWidth = character.size * 1.1;
  const barHeight = 5;
  const barX = character.x - barWidth / 2;
  let barY = character.y + half + 4;

  ctx.fillStyle = '#3a1216';
  ctx.fillRect(barX, barY, barWidth, barHeight);
  ctx.fillStyle = '#ef5350';
  ctx.fillRect(barX, barY, barWidth * (character.hp / character.hpMax), barHeight);

  barY += barHeight + 2;
  ctx.fillStyle = '#122236';
  ctx.fillRect(barX, barY, barWidth, barHeight);
  ctx.fillStyle = '#42a5f5';
  ctx.fillRect(barX, barY, barWidth * (character.mana / character.manaMax), barHeight);
}

// Barre de vie flottant au-dessus d'un ennemi (le boss) -- toujours visible, contrairement au
// bandeau de sélection du joueur qui n'apparaît que pour le personnage sélectionné.
function drawEnemyHealthBar(enemy) {
  const barWidth = enemy.size * 1.3;
  const barHeight = 8;
  const barX = enemy.x - barWidth / 2;
  const barY = enemy.y - enemy.size / 2 - 18;

  ctx.fillStyle = '#3a1216';
  ctx.fillRect(barX, barY, barWidth, barHeight);
  ctx.fillStyle = '#ef5350';
  ctx.fillRect(barX, barY, barWidth * (Math.max(enemy.hp, 0) / enemy.hpMax), barHeight);
  ctx.strokeStyle = '#00000066';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, barY + 0.5, barWidth - 1, barHeight - 1);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (enemy.name) {
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(enemy.name, enemy.x, barY - 15);
  }
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#ffffffcc';
  ctx.fillText(`${Math.max(enemy.hp, 0)}/${enemy.hpMax}`, enemy.x, barY - 3);
}

// ------------------------------------------------------------------
// Indicateurs de buff/debuff (demande utilisateur explicite : "rage, la grâce etc" doivent être
// visibles au-dessus des carrés, joueurs ET ennemis) -- une seule liste générique couvre les
// ressources à stacks propres à certaines classes (Rage, Grâce, Rempart, brûlure, poison) et tous
// les effets temporaires à minuteur déjà en place ailleurs dans le code (bouclier, ralentissement,
// étourdissement, esquive, provocation, marque, malédiction, déphasage...), sans avoir à ajouter
// un système séparé par effet.
// ------------------------------------------------------------------
function activeStatusBadges(character, now) {
  const badges = [];

  if (character.rage > 0) badges.push({ text: `Rage ${character.rage}`, rgb: '158, 158, 158' });
  if (character.priestGraceStacks > 0) badges.push({ text: `Grâce ${character.priestGraceStacks}`, rgb: '245, 245, 245' });
  if (character.rempartStacks > 0) badges.push({ text: `Rempart ${character.rempartStacks}`, rgb: '84, 110, 122' });
  if (character.pyroBurnStacks > 0) badges.push({ text: `Brûlure ${character.pyroBurnStacks}`, rgb: '255, 87, 34' });
  if (character.poisonStacks > 0) badges.push({ text: `Poison ${character.poisonStacks}`, rgb: '124, 179, 66' });

  if (character.shieldHp > 0 && (character.shieldExpiresAt || 0) > now) {
    badges.push({ text: `Bouclier ${character.shieldHp}`, rgb: '255, 213, 79' });
  }
  if ((character.damageReductionUntil || 0) > now && character.damageReductionFactor > 0) {
    badges.push({ text: `-${Math.round(character.damageReductionFactor * 100)}% subis`, rgb: '129, 199, 132' });
  }
  if ((character.damageOutputUntil || 0) > now) {
    const mult = character.damageOutputMultiplier || 1;
    if (mult > 1) badges.push({ text: `+${Math.round((mult - 1) * 100)}% dégâts`, rgb: '255, 213, 79' });
    else if (mult < 1) badges.push({ text: `${Math.round((mult - 1) * 100)}% dégâts`, rgb: '239, 83, 80' });
  }
  if ((character.damageTakenBonusUntil || 0) > now && character.damageTakenBonusFactor > 0) {
    badges.push({ text: `+${Math.round(character.damageTakenBonusFactor * 100)}% subis`, rgb: '239, 83, 80' });
  }
  if ((character.dodgeUntil || 0) > now) badges.push({ text: 'Esquive', rgb: '186, 104, 200' });
  if ((character.slowUntil || 0) > now) badges.push({ text: 'Ralenti', rgb: '79, 195, 247' });
  if ((character.stunnedUntil || 0) > now) badges.push({ text: 'Étourdi', rgb: '129, 212, 250' });
  if ((character.tauntUntil || 0) > now) badges.push({ text: 'Provoqué', rgb: '255, 193, 7' });
  if ((character.huntersMarkUntil || 0) > now) badges.push({ text: 'Marqué', rgb: '139, 195, 74' });
  if (character.cursedBy && character.cursedBy.hp > 0) badges.push({ text: 'Maudit', rgb: '81, 45, 168' });
  if ((character.phaseUntil || 0) > now) badges.push({ text: 'Déphasé', rgb: '255, 255, 255' });

  return badges;
}

// Dessine la ligne de badges centrée sur le personnage, empilée vers le haut à partir de bottomY
// (différent pour un joueur -- juste au-dessus du carré -- ou un ennemi -- au-dessus de son nom et
// de sa barre de vie, déjà affichés par-dessus lui, voir drawEnemyHealthBar).
function drawStatusBadges(character, bottomY) {
  const now = performance.now();
  const badges = activeStatusBadges(character, now);
  if (badges.length === 0) return;

  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const paddingX = 5;
  const gap = 3;
  const height = 14;
  const widths = badges.map((b) => ctx.measureText(b.text).width + paddingX * 2);
  const totalWidth = widths.reduce((sum, w) => sum + w, 0) + gap * (badges.length - 1);
  let x = character.x - totalWidth / 2;
  const y = bottomY - height;

  for (let i = 0; i < badges.length; i++) {
    const width = widths[i];
    ctx.fillStyle = `rgba(${badges[i].rgb}, 0.85)`;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#0b0f13';
    ctx.fillText(badges[i].text, x + width / 2, y + height / 2 + 1);
    x += width + gap;
  }
}

// DPS du groupe en temps réel (voir enterTrainingCombat) : total des dégâts infligés par tous les
// personnages (voir combatStats/recordDamageStat) divisé par le temps écoulé depuis le premier
// coup porté (combatActiveStartAt, voir dealDamage/loop) -- 0 tant que rien n'a encore été frappé.
function currentGroupDps(now) {
  if (!combatActiveStartAt) return 0;
  let total = 0;
  for (const key in combatStats) total += combatStats[key].dealt.total;
  const elapsedSec = (now - combatActiveStartAt) / 1000;
  return elapsedSec > 0 ? total / elapsedSec : 0;
}

function drawDpsHud(now) {
  const text = `DPS groupe : ${Math.round(currentGroupDps(now))}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 16px sans-serif';
  const y = TOP_BANNER_HEIGHT + 20;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#00000099';
  ctx.strokeText(text, canvas.width / 2, y);
  ctx.fillStyle = '#ffd54f';
  ctx.fillText(text, canvas.width / 2, y);
}

// Bouton "Quitter" de l'entraînement (demande utilisateur explicite) : affiche le même écran de
// résumé qu'une fin de combat normale (voir drawCombatEndScreen, adapté pour l'entraînement --
// titre neutre, boutons qui relancent l'entraînement/retournent à la Guilde plutôt qu'au Monde).
// L'entraînement ne se termine jamais tout seul (mannequin increvable, voir checkCombatOutcome),
// donc c'est le seul moyen d'accéder à ce résumé pendant une session.
function drawTrainingExitButton() {
  const buttonWidth = 76;
  const buttonHeight = 30;
  const x = canvas.width - buttonWidth - 10;
  const y = TOP_BANNER_HEIGHT + 8;

  ctx.fillStyle = '#37474f';
  ctx.fillRect(x, y, buttonWidth, buttonHeight);
  ctx.strokeStyle = '#ffd54f88';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, buttonWidth - 1, buttonHeight - 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#ffd54f';
  ctx.fillText('Quitter', x + buttonWidth / 2, y + buttonHeight / 2 + 1);
  registerHitRect(x, y, buttonWidth, buttonHeight, () => {
    combatPhase = 'victory'; // affiche le résumé -- voir drawCombatEndScreen
  });
}

// Panneau d'ordre de menace : s'affiche au clic sur un ennemi (voir pointerup), liste les
// personnages du joueur du plus menaçant au moins menaçant vis-à-vis de LUI. Juste la lettre de
// classe (voir character.label) plutôt que le prénom complet, demande utilisateur explicite.
function drawThreatPanel(enemy, now) {
  const ranked = characters
    .filter((c) => c.playerControlled)
    .map((c) => ({ c, threat: effectiveThreat(c, now) }))
    .sort((a, b) => b.threat - a.threat);

  const panelWidth = 128;
  const rowHeight = 24;
  const headerHeight = 28;
  const panelHeight = headerHeight + ranked.length * rowHeight + 8;

  let panelX = enemy.x + enemy.size / 2 + 14;
  if (panelX + panelWidth > canvas.width - 8) panelX = enemy.x - enemy.size / 2 - 14 - panelWidth;
  panelX = Math.max(8, Math.min(panelX, canvas.width - panelWidth - 8));
  let panelY = enemy.y - panelHeight / 2;
  panelY = Math.max(TOP_BANNER_HEIGHT + 8, Math.min(panelY, canvas.height - panelHeight - 8));

  ctx.fillStyle = 'rgba(16, 21, 26, 0.95)';
  ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
  ctx.strokeStyle = '#ffffff33';
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelWidth - 1, panelHeight - 1);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Menace', panelX + 10, panelY + headerHeight / 2 + 4);

  ranked.forEach((entry, i) => {
    const rowY = panelY + headerHeight + i * rowHeight + rowHeight / 2;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = i === 0 ? '#ffd54f' : '#ffffffcc';
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}. ${entry.c.label}`, panelX + 10, rowY);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#ffffff99';
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(entry.threat)), panelX + panelWidth - 10, rowY);
  });
}

// Une ligne "libellé ...... valeur" dans le détail déplié de l'écran de fin (voir plus bas).
function drawStatLine(x, y, width, label, value) {
  ctx.textAlign = 'left';
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#ffffffcc';
  ctx.fillText(label, x, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(value), x + width, y);
  ctx.textAlign = 'left';
}

// Écran de fin de combat (voir combatPhase) : victoire ou défaite, résumé des dégâts
// infligés/subis par personnage, et un détail dépliable par compétence/ennemi (voir
// combatStats/expandedStatsCharacter). Boutons pour relancer le même combat ou revenir à la carte.
function drawCombatEndScreen(now) {
  ctx.fillStyle = 'rgba(8, 10, 13, 0.94)';
  ctx.fillRect(0, TOP_BANNER_HEIGHT, canvas.width, canvas.height - TOP_BANNER_HEIGHT);

  const victory = combatPhase === 'victory';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 30px sans-serif';
  // En entraînement (bouton "Quitter", voir drawTrainingExitButton), le mannequin n'est jamais
  // vraiment vaincu -- un titre neutre plutôt que "VICTOIRE" évite l'affichage trompeur.
  if (isTrainingCombat) {
    ctx.fillStyle = '#ffd54f';
    ctx.fillText('RÉSUMÉ', canvas.width / 2, TOP_BANNER_HEIGHT + 42);
  } else {
    ctx.fillStyle = victory ? '#66bb6a' : '#ef5350';
    ctx.fillText(victory ? 'VICTOIRE' : 'DÉFAITE', canvas.width / 2, TOP_BANNER_HEIGHT + 42);
  }

  const cardX = LIST_PADDING_X;
  const cardWidth = canvas.width - LIST_PADDING_X * 2;
  const rowHeight = 44;
  let y = TOP_BANNER_HEIGHT + 60;

  // Butin de CETTE victoire (voir grantVictoryLoot) -- jamais pour l'entraînement, le mannequin
  // n'accorde ni XP ni objets. Équipement plus tard depuis l'onglet Personnage (voir
  // openEquipmentPicker), ici juste un rappel de ce qui vient d'être obtenu.
  if (victory && !isTrainingCombat && lastVictoryLoot.length > 0) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#ffffff99';
    ctx.fillText('Butin obtenu', cardX, y + 8);
    y += 18;
    for (const item of lastVictoryLoot) {
      const rarity = ITEM_RARITY_BY_KEY[item.rarity];
      ctx.fillStyle = rarity.color;
      ctx.fillRect(cardX, y, 12, 12);
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#ffffffcc';
      ctx.fillText(`${item.slotLabel} · ${rarity.label} · +${item.value} ${item.statLabel}`, cardX + 20, y + 10);
      y += 20;
    }
    y += 8;
  }

  // characters ne contient plus que les personnages réellement sélectionnés (voir
  // applyActivePartyToCombatSlots) -- qu'il y en ait 1 ou PARTY_SIZE, tous y figurent, sans
  // emplacement de complément à exclure.
  for (const character of characters.filter((c) => c.playerControlled)) {
    const stats = combatStats[character.index] || { dealt: { total: 0, bySkill: {}, byEnemy: {} }, taken: { total: 0, bySkill: {}, byEnemy: {} } };
    const expanded = expandedStatsCharacter === character;

    ctx.fillStyle = '#ffffff0d';
    ctx.fillRect(cardX, y, cardWidth, rowHeight);
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 1;
    ctx.strokeRect(cardX + 0.5, y + 0.5, cardWidth - 1, rowHeight - 1);

    ctx.fillStyle = character.color;
    ctx.fillRect(cardX + 10, y + 9, 14, 14);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${character.label} · ${character.className}`, cardX + 32, y + 17);

    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#ffffffbb';
    ctx.fillText(`Infligé ${stats.dealt.total}   Subi ${stats.taken.total}`, cardX + 32, y + 33);

    ctx.textAlign = 'right';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(expanded ? '▾ Détails' : '▸ Détails', cardX + cardWidth - 10, y + rowHeight / 2 + 4);
    ctx.textAlign = 'left';

    registerHitRect(cardX, y, cardWidth, rowHeight, () => {
      expandedStatsCharacter = expandedStatsCharacter === character ? null : character;
    });

    y += rowHeight + 6;

    if (expanded) {
      const dealtSkills = Object.entries(stats.dealt.bySkill).sort((a, b) => b[1] - a[1]);
      const takenByEnemy = Object.entries(stats.taken.byEnemy).sort((a, b) => b[1] - a[1]);
      // Déjà suivi par recordDamageStat (skillLabel vaut "Attaque de base" par défaut, ou le nom
      // du sort/de l'effet -- "Bombe" pour le Gobelin, voir updateBombs) mais jamais affiché
      // jusqu'ici (demande utilisateur explicite : distinguer les dégâts subis par type, ex.
      // attaque du Gobelin vs sa bombe, pas seulement par ennemi source).
      const takenBySkill = Object.entries(stats.taken.bySkill).sort((a, b) => b[1] - a[1]);
      const lineCount = Math.max(dealtSkills.length, 1) + Math.max(takenByEnemy.length, 1) + Math.max(takenBySkill.length, 1);
      const detailHeight = 60 + lineCount * 16 + 8; // 3 en-têtes de section (~18 chacun) + marges

      ctx.fillStyle = '#ffffff08';
      ctx.fillRect(cardX, y, cardWidth, detailHeight);
      ctx.strokeStyle = '#ffffff1a';
      ctx.strokeRect(cardX + 0.5, y + 0.5, cardWidth - 1, detailHeight - 1);

      let dy = y + 10;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#ffffff99';
      ctx.fillText('Infligés par compétence', cardX + 16, dy + 8);
      dy += 18;
      if (dealtSkills.length === 0) {
        drawStatLine(cardX + 20, dy, cardWidth - 36, 'Aucun', 0);
        dy += 16;
      } else {
        for (const [label, amount] of dealtSkills) {
          drawStatLine(cardX + 20, dy, cardWidth - 36, label, amount);
          dy += 16;
        }
      }

      dy += 6;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#ffffff99';
      ctx.fillText('Subis par ennemi', cardX + 16, dy + 8);
      dy += 18;
      if (takenByEnemy.length === 0) {
        drawStatLine(cardX + 20, dy, cardWidth - 36, 'Aucun', 0);
        dy += 16;
      } else {
        for (const [label, amount] of takenByEnemy) {
          drawStatLine(cardX + 20, dy, cardWidth - 36, label, amount);
          dy += 16;
        }
      }

      dy += 6;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#ffffff99';
      ctx.fillText('Subis par type', cardX + 16, dy + 8);
      dy += 18;
      if (takenBySkill.length === 0) {
        drawStatLine(cardX + 20, dy, cardWidth - 36, 'Aucun', 0);
        dy += 16;
      } else {
        for (const [label, amount] of takenBySkill) {
          drawStatLine(cardX + 20, dy, cardWidth - 36, label, amount);
          dy += 16;
        }
      }

      y += detailHeight + 8;
    }
  }

  y += 10;
  const buttonWidth = (cardWidth - 12) / 2;
  const buttonHeight = 44;

  // "Continuer" (entraînement uniquement, demande utilisateur explicite) : reprend le combat en
  // pause exactement là où il en était, sans rien réinitialiser -- contrairement à "Rejouer" qui
  // relance une session neuve. N'a pas de sens pour un vrai donjon déjà gagné/perdu.
  if (isTrainingCombat) {
    ctx.fillStyle = '#1565c0';
    ctx.fillRect(cardX, y, cardWidth, buttonHeight);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Continuer', cardX + cardWidth / 2, y + buttonHeight / 2 + 1);
    registerHitRect(cardX, y, cardWidth, buttonHeight, () => {
      combatPhase = 'active';
    });
    y += buttonHeight + 8;
  }

  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(cardX, y, buttonWidth, buttonHeight);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#ffffff';
  // En entraînement : "Rejouer" relance l'entraînement (pas un vrai combat de donjon) et le retour
  // se fait vers la Guilde (d'où l'entraînement se lance), pas vers la carte du Monde.
  ctx.fillText('Rejouer', cardX + buttonWidth / 2, y + buttonHeight / 2 + 1);
  registerHitRect(cardX, y, buttonWidth, buttonHeight, () => {
    if (isTrainingCombat) enterTrainingCombat();
    else enterCombatLevel(currentWorldLevel);
  });

  const secondX = cardX + buttonWidth + 12;
  ctx.fillStyle = '#37474f';
  ctx.fillRect(secondX, y, buttonWidth, buttonHeight);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(isTrainingCombat ? 'Retour à la Guilde' : 'Retour à la carte', secondX + buttonWidth / 2, y + buttonHeight / 2 + 1);
  registerHitRect(secondX, y, buttonWidth, buttonHeight, () => {
    currentScene = isTrainingCombat ? 'guilde' : 'monde';
  });
}

// Habillage de la phase de combat (voir combatPhase en tête de fichier) : bouton "Pull" avant le
// début du combat, compte à rebours pendant les 10s qui suivent. Rien à afficher en 'active'.
function drawPullOverlay(now) {
  const areaTop = TOP_BANNER_HEIGHT;
  const areaCenterX = canvas.width / 2;

  if (combatPhase === 'prePull') {
    // Limite visuelle des 2 tiers accessibles au joueur (voir clampPointToField/prePullMinY).
    const boundaryY = prePullMinY();
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = '#ffffff33';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, boundaryY);
    ctx.lineTo(canvas.width, boundaryY);
    ctx.stroke();
    ctx.restore();

    const buttonWidth = 160;
    const buttonHeight = 56;
    const buttonX = areaCenterX - buttonWidth / 2;
    const buttonY = areaTop + 24;

    ctx.fillStyle = '#c62828';
    ctx.fillRect(buttonX, buttonY, buttonWidth, buttonHeight);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(buttonX + 1, buttonY + 1, buttonWidth - 2, buttonHeight - 2);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('PULL', areaCenterX, buttonY + buttonHeight / 2 + 1);

    registerHitRect(buttonX, buttonY, buttonWidth, buttonHeight, startPullCountdown);
  } else if (combatPhase === 'countdown') {
    const remaining = Math.max(0, Math.ceil((pullCountdownEndAt - now) / 1000));
    const centerY = areaTop + (canvas.height - areaTop) / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 96px sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#00000099';
    ctx.strokeText(String(remaining), areaCenterX, centerY);
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(String(remaining), areaCenterX, centerY);
  }
}

const BANNER_HEIGHT = 176;
const SKILL_SLOT_COUNT = 5;
const SKILL_SLOT_GAP = 10;
const BANNER_PADDING_X = 16;

// Bandeau affiché en bas de l'écran quand un personnage du joueur est sélectionné : PV/mana et
// "Joueur i" + classe/race sur une première ligne, puis 5 emplacements de compétences (vides
// pour l'instant -- juste réservés en prévision d'un futur système de compétences) sur une
// deuxième ligne en dessous.
//
// Sur deux lignes plutôt qu'une seule rangée horizontale : un écran de téléphone en largeur
// logique (~360-420px) est bien plus étroit qu'il n'y paraît sur une capture d'écran (résolution
// physique, gonflée par la densité de pixels) -- une seule rangée avec tout ce contenu dépassait
// largement de l'écran (bandeau visible seulement en partie, compétences en partie invisibles).
// La taille des cases de compétences est aussi calculée à partir de la largeur réelle du canvas
// pour que les 5 tiennent toujours, quelle que soit la taille de l'écran.
function drawSelectionBanner(character) {
  const bannerY = canvas.height - BANNER_HEIGHT;

  ctx.fillStyle = 'rgba(16, 21, 26, 0.92)';
  ctx.fillRect(0, bannerY, canvas.width, BANNER_HEIGHT);
  ctx.strokeStyle = '#ffffff22';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, bannerY);
  ctx.lineTo(canvas.width, bannerY);
  ctx.stroke();

  const lineHeight = 20;
  const barWidth = Math.min(130, canvas.width * 0.32);
  const barHeight = 8;

  // Ligne du haut, colonne PV / mana.
  let colX = BANNER_PADDING_X;
  let rowY = bannerY + 24;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`PV  ${character.hp}/${character.hpMax}`, colX, rowY);
  ctx.fillStyle = '#3a1216';
  ctx.fillRect(colX, rowY + 8, barWidth, barHeight);
  ctx.fillStyle = '#ef5350';
  ctx.fillRect(colX, rowY + 8, barWidth * (character.hp / character.hpMax), barHeight);

  rowY += lineHeight + barHeight + 6;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`Mana ${Math.floor(character.mana)}/${character.manaMax}`, colX, rowY);
  ctx.fillStyle = '#122236';
  ctx.fillRect(colX, rowY + 8, barWidth, barHeight);
  ctx.fillStyle = '#42a5f5';
  ctx.fillRect(colX, rowY + 8, barWidth * (character.mana / character.manaMax), barHeight);

  // Ligne du haut, colonne prénom du joueur / classe du personnage loué.
  const player = players.find((p) => p.index === character.index);
  colX += barWidth + 24;
  const topRowMidY = bannerY + 46;
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(player ? player.name : `Joueur ${character.index}`, colX, topRowMidY - 4);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#ffffffaa';
  ctx.fillText(`${character.className} · Niv. ${character.level}`, colX, topRowMidY + 16);

  // Deuxième ligne : emplacements de compétences -- les 2 premiers affichent les sorts de la
  // classe du personnage (voir CLASS_SKILLS), le reste reste vide en attendant d'autres sorts.
  // Taille adaptée pour que les 5 cases tiennent toujours dans la largeur de l'écran.
  const skillsRowY = bannerY + 92;
  const skillsRowHeight = BANNER_HEIGHT - 92 - 16;
  const availableWidth = canvas.width - BANNER_PADDING_X * 2;
  const slotSize = Math.max(
    28,
    Math.min(64, skillsRowHeight, (availableWidth - (SKILL_SLOT_COUNT - 1) * SKILL_SLOT_GAP) / SKILL_SLOT_COUNT)
  );
  const totalSkillsWidth = SKILL_SLOT_COUNT * slotSize + (SKILL_SLOT_COUNT - 1) * SKILL_SLOT_GAP;
  const skillsStartX = (canvas.width - totalSkillsWidth) / 2;
  const skillsY = skillsRowY + (skillsRowHeight - slotSize) / 2;
  const skillIds = CLASS_SKILLS[character.className] || [];
  const now = performance.now();

  for (let i = 0; i < SKILL_SLOT_COUNT; i++) {
    const slotX = skillsStartX + i * (slotSize + SKILL_SLOT_GAP);
    const skill = SKILLS[skillIds[i]];
    if (skill) {
      drawSkillSlot(character, skill, slotX, skillsY, slotSize, now);
    } else {
      ctx.fillStyle = '#ffffff14';
      ctx.fillRect(slotX, skillsY, slotSize, slotSize);
      ctx.strokeStyle = '#ffffff55';
      ctx.lineWidth = 1;
      ctx.strokeRect(slotX + 0.5, skillsY + 0.5, slotSize - 1, slotSize - 1);
    }
  }
}

// Une case de compétence : libellé du sort, assombrie + décompte pendant le temps de recharge.
// Un clic dessus lance le sort (voir castSkill) -- enregistré comme n'importe quelle autre zone
// interactive hors combat (interactiveRects), sauf qu'ici on est dans la scène combat elle-même.
function drawSkillSlot(character, skill, slotX, slotY, slotSize, now) {
  const locked = combatPhase === 'prePull'; // pull pas encore lancé : aucune compétence utilisable
  const readyAt = (character.cooldowns && character.cooldowns[skill.id]) || 0;
  const remaining = locked ? skill.cooldownMs : Math.max(0, readyAt - now);
  const onCooldown = locked || remaining > 0;

  ctx.fillStyle = '#ffffff20';
  ctx.fillRect(slotX, slotY, slotSize, slotSize);

  ctx.save();
  ctx.beginPath();
  ctx.rect(slotX, slotY, slotSize, slotSize);
  ctx.clip();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.max(8, Math.round(slotSize * 0.16))}px sans-serif`;
  ctx.fillStyle = onCooldown ? '#ffffff66' : '#ffffff';
  const lines = skill.shortLabel.split('\n');
  const lineHeight = slotSize * 0.22;
  const startY = slotY + slotSize / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, slotX + slotSize / 2, startY + i * lineHeight));

  if (onCooldown) {
    ctx.fillStyle = '#00000099';
    ctx.fillRect(slotX, slotY, slotSize, locked ? slotSize : slotSize * (remaining / skill.cooldownMs));
    if (!locked) {
      ctx.font = `bold ${Math.max(10, Math.round(slotSize * 0.28))}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(Math.ceil(remaining / 1000)), slotX + slotSize / 2, slotY + slotSize / 2);
    }
  }
  ctx.restore();

  ctx.strokeStyle = '#ffffff55';
  ctx.lineWidth = 1;
  ctx.strokeRect(slotX + 0.5, slotY + 0.5, slotSize - 1, slotSize - 1);

  if (!locked) registerHitRect(slotX, slotY, slotSize, slotSize, () => castSkill(character, skill.id));
}

// Calcule une taille de police qui fait tenir tous les libellés dans la largeur d'un bouton --
// même logique que pour le bandeau du bas (SKILL_SLOT_COUNT) : la largeur logique réelle d'un
// écran de téléphone est bien plus étroite qu'elle n'y paraît sur une capture d'écran.
function fittingFontSize(labels, maxWidth, startSize, minSize) {
  let size = startSize;
  ctx.font = `bold ${size}px sans-serif`;
  for (const label of labels) {
    while (size > minSize && ctx.measureText(label).width > maxWidth) {
      size -= 1;
      ctx.font = `bold ${size}px sans-serif`;
    }
  }
  return size;
}

function drawTopBanner() {
  ctx.fillStyle = 'rgba(16, 21, 26, 0.95)';
  ctx.fillRect(0, 0, canvas.width, TOP_BANNER_HEIGHT);
  ctx.strokeStyle = '#ffffff22';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, TOP_BANNER_HEIGHT);
  ctx.lineTo(canvas.width, TOP_BANNER_HEIGHT);
  ctx.stroke();

  const rects = sceneButtonRects();
  const fontSize = fittingFontSize(SCENES.map((s) => s.label), rects[0].width - 12, 14, 9);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const rect of rects) {
    const active = rect.scene === currentScene;
    if (active) {
      ctx.fillStyle = '#ffffff14';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rect.x, rect.height - 1);
      ctx.lineTo(rect.x + rect.width, rect.height - 1);
      ctx.stroke();
    }
    ctx.font = active ? `bold ${fontSize}px sans-serif` : `${fontSize}px sans-serif`;
    ctx.fillStyle = active ? '#ffffff' : '#ffffffaa';
    ctx.fillText(rect.label, rect.x + rect.width / 2, rect.y + rect.height / 2 + 1);
  }

  ctx.strokeStyle = '#ffffff14';
  ctx.lineWidth = 1;
  for (let i = 1; i < rects.length; i++) {
    ctx.beginPath();
    ctx.moveTo(rects[i].x, 0);
    ctx.lineTo(rects[i].x, TOP_BANNER_HEIGHT);
    ctx.stroke();
  }
}

// Zones cliquables des scènes hors combat (ex. barres de compétence du joueur), recalculées à
// chaque image par draw() puis consultées par pointerdown -- même logique que sceneButtonRects,
// généralisée : la scène qui dessine un élément interactif enregistre ici sa zone et l'action à
// déclencher, pointerdown n'a donc pas à connaître la mise en page de chaque scène.
let interactiveRects = [];

function registerHitRect(x, y, width, height, onClick) {
  interactiveRects.push({ x, y, width, height, onClick });
}

function hitTestInteractiveRects(x, y) {
  for (let i = interactiveRects.length - 1; i >= 0; i--) {
    const r = interactiveRects[i];
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return r;
  }
  return null;
}

// Zones "survolables" (mouseover) -- même principe que interactiveRects ci-dessus, mais pour de
// l'affichage au survol plutôt qu'au clic (ex. le détail des compétences dans l'onglet
// Personnage, voir drawRosterCharacterDetail). Recalculées à chaque image, consultées par le
// pointermove de survol ci-dessous. Sans effet sur tactile (pas de survol sans contact) --
// fonctionnalité pensée pour la souris/le web, demande utilisateur explicite ("lisible avec un
// mousseover").
let hoverRects = [];
let hoveredSkillsCharacter = null;

function registerHoverRect(x, y, width, height, data) {
  hoverRects.push({ x, y, width, height, data });
}

function hitTestHoverRects(x, y) {
  for (let i = hoverRects.length - 1; i >= 0; i--) {
    const r = hoverRects[i];
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return r.data;
  }
  return null;
}

const LIST_PADDING_X = 16;
const CARD_PADDING = 14;
const CARD_GAP = 12;

function incrementSkill(player, key) {
  player.skills[key] = Math.min(SKILL_MAX, player.skills[key] + 1);
}

// Jauge à la façon des Sims : des cases pleines jusqu'à la valeur actuelle, vides au-delà.
function drawPipBar(x, y, width, height, value, max, filledColor) {
  const gap = 3;
  const segWidth = (width - gap * (max - 1)) / max;
  for (let i = 0; i < max; i++) {
    const segX = x + i * (segWidth + gap);
    ctx.fillStyle = i < value ? filledColor : '#ffffff1a';
    ctx.fillRect(segX, y, segWidth, height);
  }
}

// Une ligne de compétence de joueur : libellé + valeur, puis la jauge cliquable (un clic ajoute
// un point, plafonné à SKILL_MAX). Renvoie le y de la ligne suivante.
function drawSkillRow(player, key, label, x, y, width) {
  const value = player.skills[key];
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#ffffffcc';
  ctx.fillText(`${label}  ${value}/${SKILL_MAX}`, x, y + 11);

  const barY = y + 16;
  const barHeight = 14;
  drawPipBar(x, barY, width, barHeight, value, SKILL_MAX, '#4fc3f7');
  registerHitRect(x, barY, width, barHeight, () => incrementSkill(player, key));

  return y + 16 + barHeight + 10;
}

// Scène "Joueur" : la liste des joueurs (humains simulés qui louent les personnages), avec leurs
// deux compétences améliorables au clic (voir drawSkillRow).
function drawPlayerScene() {
  const cardX = LIST_PADDING_X;
  const cardWidth = canvas.width - LIST_PADDING_X * 2;
  const cardHeight = 158;
  const viewTop = TOP_BANNER_HEIGHT;
  let y = viewTop + 16 - getSceneScrollY('joueur');

  // Toujours PARTY_SIZE (4) cartes ici, contrairement au roster qui grandit -- tient sur la
  // plupart des écrans, mais pas forcément tous (demande utilisateur explicite : anticiper le même
  // problème de défilement que Personnage/Guilde avant qu'il ne se pose vraiment).
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, viewTop, canvas.width, canvas.height - viewTop);
  ctx.clip();

  for (const player of players) {
    const character = characters.find((c) => c.playerControlled && c.index === player.index);

    ctx.fillStyle = '#ffffff0d';
    ctx.fillRect(cardX, y, cardWidth, cardHeight);
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 1;
    ctx.strokeRect(cardX + 0.5, y + 0.5, cardWidth - 1, cardHeight - 1);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${player.name}  ·  Niveau ${player.level}`, cardX + CARD_PADDING, y + CARD_PADDING + 12);

    if (character) {
      // Rappelle quel personnage ce joueur loue (carré + classe correspondants).
      ctx.fillStyle = character.color;
      ctx.fillRect(cardX + cardWidth - CARD_PADDING - 14, y + CARD_PADDING - 1, 14, 14);
      ctx.textAlign = 'right';
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#ffffffaa';
      ctx.fillText(character.className, cardX + cardWidth - CARD_PADDING - 20, y + CARD_PADDING + 11);
      ctx.textAlign = 'left';
    }

    // Barre d'XP -- valeurs provisoires (voir VICTORY_XP/xpToNextLevel), juste le mécanisme.
    let rowY = y + CARD_PADDING + 26;
    const xpNeeded = xpToNextLevel(player.level);
    const fullWidth = cardWidth - CARD_PADDING * 2;
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#ffffff99';
    ctx.fillText(`XP ${player.xp}/${xpNeeded}`, cardX + CARD_PADDING, rowY);
    ctx.fillStyle = '#ffffff14';
    ctx.fillRect(cardX + CARD_PADDING, rowY + 4, fullWidth, 5);
    ctx.fillStyle = '#ffd54f';
    ctx.fillRect(cardX + CARD_PADDING, rowY + 4, fullWidth * Math.min(player.xp / xpNeeded, 1), 5);
    rowY += 22;

    rowY = drawSkillRow(player, 'apm', 'APM', cardX + CARD_PADDING, rowY, cardWidth - CARD_PADDING * 2);
    drawSkillRow(player, 'connaissanceJeu', 'Connaissance du jeu', cardX + CARD_PADDING, rowY, cardWidth - CARD_PADDING * 2);

    y += cardHeight + CARD_GAP;
  }

  ctx.restore();

  setSceneContentHeight('joueur', y + getSceneScrollY('joueur') - viewTop);
  drawSceneScrollbar('joueur', viewTop);
}

// Scène "Personnage" : la liste des personnages loués (classe, niveau, caractéristiques). Simple
// affichage pour l'instant -- pas encore de points à répartir ici, contrairement aux compétences
// du joueur ci-dessus.
const STAT_ROWS = [
  ['Force', 'force'],
  ['Agilité', 'agilite'],
  ['Endurance', 'endurance'],
  ['Intelligence', 'intelligence'],
  ['Savoir', 'savoir'],
];
const STAT_MAX = 20;
let expandedRosterCharacter = null; // personnage du roster dont le détail est déplié
let openEquipmentPicker = null; // { character, slotKey }, voir drawEquipmentPickerOverlay

// Détail complet d'un personnage du roster (XP, caractéristiques, équipement) -- déplié sous sa
// ligne compacte dans la scène Personnage quand on tape dessus. Renvoie la hauteur utilisée.
function drawRosterCharacterDetail(character, x, y, width) {
  let rowY = y + 10;
  const xpNeeded = xpToNextLevel(character.level);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#ffffff99';
  ctx.fillText(`XP ${character.xp}/${xpNeeded}`, x, rowY);
  ctx.fillStyle = '#ffffff14';
  ctx.fillRect(x, rowY + 4, width, 5);
  ctx.fillStyle = '#ffd54f';
  ctx.fillRect(x, rowY + 4, width * Math.min(character.xp / xpNeeded, 1), 5);
  rowY += 24;

  const labelWidth = 90;
  const valueColWidth = 28;
  const barX = x + labelWidth;
  const barWidth = width - labelWidth - valueColWidth;
  for (const [label, key] of STAT_ROWS) {
    const value = character.stats[key];
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#ffffffcc';
    ctx.fillText(label, x, rowY + 9);
    ctx.fillStyle = '#ffffff14';
    ctx.fillRect(barX, rowY, barWidth, 10);
    ctx.fillStyle = character.color;
    ctx.fillRect(barX, rowY, barWidth * Math.min(value / STAT_MAX, 1), 10);
    ctx.textAlign = 'right';
    ctx.fillText(String(value), x + width, rowY + 9);
    ctx.textAlign = 'left';
    rowY += 20;
  }

  rowY += 6;
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#ffffff99';
  ctx.fillText(inventory.length > 0 ? `Équipement · ${inventory.length} objet(s) en inventaire` : 'Équipement', x, rowY + 8);
  rowY += 14;

  // Une case par emplacement (voir EQUIPMENT_SLOTS) -- teintée de la couleur de rareté si occupée
  // (voir ITEM_RARITY_BY_KEY), tapoter ouvre le choix parmi les objets compatibles de l'inventaire
  // (voir openEquipmentPicker/drawEquipmentPickerOverlay, demande utilisateur explicite : "le
  // joueur choisit lui-même").
  const slotGap = 4;
  const slotSize = Math.min(30, (width - (EQUIPMENT_SLOTS.length - 1) * slotGap) / EQUIPMENT_SLOTS.length);
  let slotX = x;
  for (const eqSlot of EQUIPMENT_SLOTS) {
    const item = character.equipment[eqSlot.key];
    const rarity = item ? ITEM_RARITY_BY_KEY[item.rarity] : null;
    ctx.fillStyle = rarity ? `${rarity.color}33` : '#ffffff10';
    ctx.fillRect(slotX, rowY, slotSize, slotSize);
    ctx.strokeStyle = rarity ? rarity.color : '#ffffff33';
    ctx.lineWidth = 1;
    ctx.strokeRect(slotX + 0.5, rowY + 0.5, slotSize - 1, slotSize - 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.max(7, Math.round(slotSize * 0.32))}px sans-serif`;
    ctx.fillStyle = item ? '#ffffff' : '#ffffff55';
    ctx.fillText(item ? item.label : eqSlot.label.slice(0, 2), slotX + slotSize / 2, rowY + slotSize / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    registerHitRect(slotX, rowY, slotSize, slotSize, () => {
      openEquipmentPicker = { character, slotKey: eqSlot.key };
    });
    slotX += slotSize + slotGap;
  }
  rowY += slotSize + 8;

  // Case "Compétences" : juste une case (demande utilisateur explicite), le détail des 4 sorts de
  // la classe ne s'affiche qu'au survol (voir drawSkillsTooltip, appelé depuis draw() quand
  // hoveredSkillsCharacter est renseigné par le pointermove de survol ci-dessous).
  const skillsTileHeight = 26;
  const hovered = hoveredSkillsCharacter === character;
  ctx.fillStyle = hovered ? '#ffd54f22' : '#ffffff0d';
  ctx.fillRect(x, rowY, width, skillsTileHeight);
  ctx.strokeStyle = hovered ? '#ffd54f' : '#ffffff33';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, rowY + 0.5, width - 1, skillsTileHeight - 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '11px sans-serif';
  ctx.fillStyle = hovered ? '#ffd54f' : '#ffffff99';
  ctx.fillText('Compétences (survoler pour le détail)', x + width / 2, rowY + skillsTileHeight / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  registerHoverRect(x, rowY, width, skillsTileHeight, character);
  rowY += skillsTileHeight + 8;

  return rowY - y;
}

// Découpe un texte en lignes tenant chacune dans maxWidth (avec la police déjà réglée sur ctx),
// mot par mot -- pas de césure en plein milieu d'un mot.
function wrapText(text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Bulle de détail des 4 compétences de la classe -- affichée par-dessus tout le reste tant que la
// case "Compétences" est survolée (voir hoveredSkillsCharacter). Positionnée pour rester entière
// à l'écran (jamais coupée en haut, en bas ou sur les côtés).
function drawSkillsTooltip(character) {
  const skillIds = CLASS_SKILLS[character.className] || [];
  const padding = 10;
  const lineGap = 4;
  const nameFont = 'bold 12px sans-serif';
  const descFont = '11px sans-serif';
  const width = Math.min(320, canvas.width - 24);
  const descMaxWidth = width - padding * 2;

  ctx.font = descFont;
  const entries = skillIds.map((id) => {
    const skill = SKILLS[id];
    const lines = wrapText(skill.description || '', descMaxWidth);
    return { skill, lines };
  });

  let contentHeight = padding;
  for (const entry of entries) {
    contentHeight += 16 + entry.lines.length * 14 + lineGap + 6;
  }
  contentHeight += padding - 6;

  // Centré horizontalement, positionné juste sous le bandeau du haut (toujours visible, quelle
  // que soit la ligne survolée dans la liste défilée... enfin, sans défilement -- juste une
  // position fixe simple et prévisible).
  const boxX = (canvas.width - width) / 2;
  const boxY = Math.min(TOP_BANNER_HEIGHT + 10, canvas.height - contentHeight - 10);

  ctx.fillStyle = 'rgba(16, 21, 26, 0.97)';
  ctx.fillRect(boxX, boxY, width, contentHeight);
  ctx.strokeStyle = '#ffd54f88';
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX + 0.5, boxY + 0.5, width - 1, contentHeight - 1);

  let rowY = boxY + padding;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const { skill, lines } of entries) {
    ctx.font = nameFont;
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(skill.name, boxX + padding, rowY + 11);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff77';
    ctx.font = '10px sans-serif';
    ctx.fillText(`${Math.round(skill.cooldownMs / 1000)}s`, boxX + width - padding, rowY + 11);
    ctx.textAlign = 'left';
    rowY += 16;

    ctx.font = descFont;
    ctx.fillStyle = '#ffffffcc';
    for (const line of lines) {
      ctx.fillText(line, boxX + padding, rowY + 10);
      rowY += 14;
    }
    rowY += lineGap + 6;
  }
}

// Menu ouvert en tapant un emplacement d'équipement (voir openEquipmentPicker/
// drawRosterCharacterDetail) : plein écran par-dessus tout le reste, même schéma que
// drawAccountDropdownOverlay -- "Retirer" (si occupé) renvoie l'objet en inventaire, puis un objet
// compatible (même slotKey) de l'inventaire par ligne, coloré selon sa rareté.
function drawEquipmentPickerOverlay() {
  const { character, slotKey } = openEquipmentPicker;
  const eqSlot = EQUIPMENT_SLOTS.find((s) => s.key === slotKey);
  const currentItem = character.equipment[slotKey];
  const options = inventory.filter((it) => it.slotKey === slotKey);

  ctx.fillStyle = 'rgba(8, 10, 13, 0.92)';
  ctx.fillRect(0, TOP_BANNER_HEIGHT, canvas.width, canvas.height - TOP_BANNER_HEIGHT);
  registerHitRect(0, TOP_BANNER_HEIGHT, canvas.width, canvas.height - TOP_BANNER_HEIGHT, () => { openEquipmentPicker = null; });

  const cardX = LIST_PADDING_X;
  const cardWidth = canvas.width - LIST_PADDING_X * 2;
  const panelY = TOP_BANNER_HEIGHT + 16;
  const headerHeight = 40;
  const rowHeight = 44;
  // "Retirer" (si occupé) + soit une ligne par objet compatible, soit une seule ligne d'invite si
  // l'inventaire n'en a aucun -- toujours l'un OU l'autre, jamais les deux à la fois, voir plus bas.
  const rowCount = (currentItem ? 1 : 0) + (options.length > 0 ? options.length : 1);
  const panelHeight = headerHeight + rowCount * rowHeight + 10;

  ctx.fillStyle = '#1b232b';
  ctx.fillRect(cardX, panelY, cardWidth, panelHeight);
  ctx.strokeStyle = '#ffd54f88';
  ctx.lineWidth = 1;
  ctx.strokeRect(cardX + 0.5, panelY + 0.5, cardWidth - 1, panelHeight - 1);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#ffd54f';
  ctx.fillText(`Équiper : ${eqSlot.label} (${character.className})`, cardX + CARD_PADDING, panelY + headerHeight / 2);

  let optY = panelY + headerHeight;

  if (currentItem) {
    const rarity = ITEM_RARITY_BY_KEY[currentItem.rarity];
    ctx.fillStyle = '#ffffff0d';
    ctx.fillRect(cardX, optY, cardWidth, rowHeight);
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 1;
    ctx.strokeRect(cardX + 0.5, optY + 0.5, cardWidth - 1, rowHeight - 1);
    ctx.fillStyle = rarity.color;
    ctx.fillRect(cardX + CARD_PADDING, optY + rowHeight / 2 - 7, 14, 14);
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`Retirer (${rarity.label} · +${currentItem.value} ${currentItem.statLabel})`, cardX + CARD_PADDING + 22, optY + rowHeight / 2 + 1);
    registerHitRect(cardX, optY, cardWidth, rowHeight, () => {
      setEquippedItem(character, slotKey, null);
      openEquipmentPicker = null;
    });
    optY += rowHeight;
  }

  if (options.length === 0) {
    ctx.fillStyle = '#ffffff0d';
    ctx.fillRect(cardX, optY, cardWidth, rowHeight);
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 1;
    ctx.strokeRect(cardX + 0.5, optY + 0.5, cardWidth - 1, rowHeight - 1);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#ffffff77';
    ctx.fillText('Aucun objet disponible pour cet emplacement', cardX + CARD_PADDING, optY + rowHeight / 2 + 1);
  } else {
    for (const item of options) {
      const rarity = ITEM_RARITY_BY_KEY[item.rarity];
      ctx.fillStyle = '#ffffff0d';
      ctx.fillRect(cardX, optY, cardWidth, rowHeight);
      ctx.strokeStyle = '#ffffff22';
      ctx.lineWidth = 1;
      ctx.strokeRect(cardX + 0.5, optY + 0.5, cardWidth - 1, rowHeight - 1);
      ctx.fillStyle = rarity.color;
      ctx.fillRect(cardX + CARD_PADDING, optY + rowHeight / 2 - 7, 14, 14);
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${rarity.label} · +${item.value} ${item.statLabel}`, cardX + CARD_PADDING + 22, optY + rowHeight / 2 + 1);
      registerHitRect(cardX, optY, cardWidth, rowHeight, () => {
        setEquippedItem(character, slotKey, item);
        openEquipmentPicker = null;
      });
      optY += rowHeight;
    }
  }
}

// Scène "Personnage" : tout le roster (les 11 classes possédées), pas seulement les 4 actuellement
// en donjon -- demande utilisateur explicite (voir la scène Guilde pour choisir qui part). Une
// ligne compacte par personnage (11 ne tiennent pas tous en détail complet sans défilement, qui
// n'existe pas dans ce jeu) ; taper une ligne déplie son détail (XP/stats/équipement).
function drawCharacterScene() {
  const cardX = LIST_PADDING_X;
  const cardWidth = canvas.width - LIST_PADDING_X * 2;
  const rowHeight = 54;
  const viewTop = TOP_BANNER_HEIGHT + 16;
  let y = viewTop - getSceneScrollY('personnage');

  // Le contenu (12 personnages + détail déplié éventuel) peut largement dépasser l'écran -- on le
  // découpe au bandeau du haut pour qu'un personnage partiellement scrollé ne s'affiche pas
  // par-dessus (voir sceneScrollY, mis à jour par le pointermove de défilement).
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, TOP_BANNER_HEIGHT, canvas.width, canvas.height - TOP_BANNER_HEIGHT);
  ctx.clip();

  for (const character of roster) {
    const slot = activePartyIndices.indexOf(character.rosterId);
    const inParty = slot !== -1;
    const player = inParty ? players[slot] : null;
    const expanded = expandedRosterCharacter === character;

    ctx.fillStyle = '#ffffff0d';
    ctx.fillRect(cardX, y, cardWidth, rowHeight);
    ctx.strokeStyle = inParty ? '#ffd54f55' : '#ffffff22';
    ctx.lineWidth = 1;
    ctx.strokeRect(cardX + 0.5, y + 0.5, cardWidth - 1, rowHeight - 1);

    ctx.fillStyle = character.color;
    ctx.fillRect(cardX + CARD_PADDING, y + CARD_PADDING - 1, 14, 14);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${character.className}  ·  Niveau ${character.level}`, cardX + CARD_PADDING + 22, y + 21);

    ctx.font = '11px sans-serif';
    ctx.fillStyle = inParty ? '#ffd54f' : '#ffffff77';
    ctx.fillText(inParty ? `En donjon · ${player.name}` : 'Au repos', cardX + CARD_PADDING + 22, y + 37);

    ctx.textAlign = 'right';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(expanded ? '▾' : '▸', cardX + cardWidth - 12, y + rowHeight / 2 + 4);
    ctx.textAlign = 'left';

    registerHitRect(cardX, y, cardWidth, rowHeight, () => {
      expandedRosterCharacter = expandedRosterCharacter === character ? null : character;
    });

    y += rowHeight + 6;

    if (expanded) {
      const detailHeight = drawRosterCharacterDetail(character, cardX + CARD_PADDING, y, cardWidth - CARD_PADDING * 2);
      y += detailHeight + 10;
    }
  }

  ctx.restore();

  setSceneContentHeight('personnage', y + getSceneScrollY('personnage') - viewTop);
  drawSceneScrollbar('personnage', viewTop);

  if (openEquipmentPicker) drawEquipmentPickerOverlay();
}

// Repère visuel minimal indiquant qu'une scène à défilement (voir SCROLLABLE_SCENES) a plus de
// contenu à voir en glissant -- aucun autre indice sinon, vu qu'il n'y a pas de défilement ailleurs
// dans le jeu. Partagé entre l'onglet Personnage et l'onglet Guilde.
function drawSceneScrollbar(scene, viewTop) {
  const maxScroll = sceneMaxScroll(scene);
  if (maxScroll <= 0) return;
  const viewportHeight = canvas.height - viewTop;
  const contentHeight = sceneContentHeight[scene] || 1;
  const thumbHeight = Math.max(24, (viewportHeight / contentHeight) * viewportHeight);
  const thumbY = viewTop + (getSceneScrollY(scene) / maxScroll) * (viewportHeight - thumbHeight);
  ctx.fillStyle = '#ffffff33';
  ctx.fillRect(canvas.width - 4, thumbY, 3, thumbHeight);
}

// ------------------------------------------------------------
// Scène "Monde" : une carte de progression -- un chemin reliant des ronds, chacun un combat
// différent (voir ENCOUNTERS), le dernier étant le boss final. Cliquer un rond débloqué (déjà
// atteint ou le prochain) reconfigure l'unique emplacement d'ennemi du jeu avec les stats de ce
// combat (voir resetCombatEncounter) et bascule sur la scène Combat ; le rond suivant se débloque
// quand l'ennemi actuel tombe à 0 PV (déjà visible via sa croix de mort, voir drawCharacter).
// ------------------------------------------------------------
const WORLD_LEVELS = ENCOUNTERS.map((encounter) => ({ label: encounter.label, isBoss: !!encounter.isBoss }));
let worldProgress = 0; // index du prochain rond à vaincre ; les index < ça sont déjà complétés
let currentWorldLevel = 0; // rond correspondant au combat affiché dans la scène Combat
let combatOutcomeHandled = false; // évite de débloquer le rond suivant en boucle une fois le boss tombé

function worldLevelPositions() {
  const top = TOP_BANNER_HEIGHT + 50;
  const bottom = canvas.height - 40;
  const count = WORLD_LEVELS.length;
  const usableHeight = Math.max(bottom - top, 1);
  return WORLD_LEVELS.map((level, index) => {
    const t = count === 1 ? 0 : index / (count - 1);
    return {
      x: canvas.width * (index % 2 === 0 ? 0.32 : 0.68),
      y: bottom - t * usableHeight, // le niveau 0 en bas, le boss final tout en haut
      level,
      index,
    };
  });
}

// Reconfigure l'unique emplacement d'ennemi du jeu avec les stats du combat choisi (voir
// ENCOUNTERS) et remet tout le monde à zéro : PV/mana/bouclier/altérations/cooldowns des
// personnages et de l'ennemi réinitialisés, tout replacé à sa position de départ -- un "nouveau"
// combat à chaque clic sur un rond, plutôt que de reprendre les dégâts du combat précédent.
// Remet à zéro tous les états de combat temporaires d'un personnage (bouclier, statuts, ressource
// de classe...) qu'un des 44 sorts peut poser -- partagé entre l'ennemi et les personnages du
// joueur dans resetCombatEncounter ci-dessous, pour ne pas dupliquer une liste aussi longue.
function resetTransientCombatState(entity) {
  entity.attackTarget = null;
  entity.dotEffects = [];
  entity.isMoving = false;
  entity.pathPoints = [];
  entity.shieldHp = 0;
  entity.shieldMax = 0;
  entity.shieldExpiresAt = 0;
  entity.shieldReflectBurn = false;
  entity.shieldReflectSlow = false;
  entity.shieldVengeful = false;
  entity.shieldAbsorbedTotal = 0;
  entity.lastShieldAttacker = null;
  entity.tauntedBy = null;
  entity.tauntUntil = 0;
  entity.slowMultiplier = 1;
  entity.slowUntil = 0;
  entity.atkSlowMultiplier = 1;
  entity.atkSlowUntil = 0;
  entity.stunnedUntil = 0;
  entity.damageReductionFactor = 0;
  entity.damageReductionUntil = 0;
  entity.damageOutputMultiplier = 1;
  entity.damageOutputUntil = 0;
  entity.damageTakenBonusFactor = 0;
  entity.damageTakenBonusUntil = 0;
  entity.poisonStacks = 0;
  entity.huntersMarkUntil = 0;
  entity.cursedBy = null;
  entity.rage = 0;
  entity.epidemieNextThreshold = 0;
  entity.guaranteedBackstabUntil = 0;
  entity.pyroBurnStacks = 0;
  entity.pyroBurnExpiresAt = 0;
  entity.pyroBurnNextTickAt = 0;
  entity.priestGraceStacks = 0;
  entity.rempartStacks = 0;
  entity.rempartExpiresAt = 0;
  entity.nextBombAt = 0;
  entity.bombDashTarget = null;
  entity.bombDashUntil = 0;
  entity.nextBombCheckAt = 0;
  entity.nextFlyingBombAt = 0;
  entity.flyingBombCounted = false;
}

// Remet les personnages sélectionnés en place au début d'un combat (PV/mana pleins, plus d'effets
// ni de menace résiduels...) -- commun à un donjon normal (resetCombatEncounter) et à
// l'entraînement (enterTrainingCombat), seule la configuration de l'ennemi diffère entre les deux.
// Toujours exactement les personnages d'activePartyIndices (1 à PARTY_SIZE, voir
// applyActivePartyToCombatSlots) : aucun emplacement de complément à neutraliser.
function resetPlayerCombatState() {
  // Rebranche le groupe actif (voir scène Guilde) sur les emplacements de combat : une
  // composition changée depuis la dernière bataille ne prend effet qu'à partir d'ici.
  applyActivePartyToCombatSlots();

  let i = 0;
  const count = characters.filter((c) => c.playerControlled).length;
  for (const character of characters) {
    if (!character.playerControlled) continue;
    character.hp = character.hpMax;
    character.mana = character.manaMax;
    character.cooldowns = {};
    character.threat = 0;
    character.lastThreatAt = 0;
    character.dodgeChance = 0;
    character.dodgeUntil = 0;
    character.phaseUntil = 0;
    character.lastDamageTakenAt = 0;
    character.lastAutoSkillAt = 0;
    character.selected = false;
    resetTransientCombatState(character);
    character.x = squareXFor(i, count);
    character.y = cy;
    i += 1;
  }
}

function resetCombatEncounter(levelIndex) {
  const encounter = ENCOUNTERS[levelIndex];
  const enemy = enemies[0];
  if (enemy && encounter) {
    enemy.name = encounter.name;
    enemy.label = encounter.label;
    enemy.color = encounter.color;
    enemy.size = encounter.size;
    enemy.hpMax = encounter.hpMax;
    enemy.hp = encounter.hpMax;
    enemy.combatOverride = encounter.combat;
    enemy.stats = { force: encounter.statValue };
    enemy.trainingDummy = false;
    enemy.bombAttack = encounter.bombAttack || null;
    enemy.stationary = !!encounter.stationary;
    enemy.flyingBombAttack = !!encounter.flyingBombAttack;
    resetTransientCombatState(enemy);
    const spawn = clampPointToField({ size: encounter.size }, cx, cy - 220);
    enemy.x = spawn.x;
    enemy.y = spawn.y;
  }
  activeBombs = [];
  flyingBombs = [];

  resetPlayerCombatState();
}

function enterCombatLevel(index) {
  currentWorldLevel = index;
  combatOutcomeHandled = false;
  combatPhase = 'prePull';
  combatActiveStartAt = 0;
  isTrainingCombat = false;
  threatPanelEnemy = null;
  expandedStatsCharacter = null;
  resetCombatEncounter(index);
  combatStats = createCombatStats(); // après resetCombatEncounter : a besoin des personnages déjà en place
  currentScene = 'combat';
}

// "Entraînement" (voir bouton dans l'onglet Sélection roster) : combat spécial contre un mannequin
// à PV énormes qui n'attaque jamais (enemy.trainingDummy, voir updateEnemyAI) -- juste histoire de
// taper dedans pour mesurer son DPS (voir drawDpsHud) sans risque pour le groupe ni impact sur la
// progression du Monde (voir isTrainingCombat dans checkCombatOutcome).
const TRAINING_DUMMY_HP = 500000;

function enterTrainingCombat() {
  combatOutcomeHandled = false;
  combatPhase = 'prePull';
  combatActiveStartAt = 0;
  isTrainingCombat = true;
  threatPanelEnemy = null;
  expandedStatsCharacter = null;

  const enemy = enemies[0];
  if (enemy) {
    enemy.name = "Mannequin d'entraînement";
    enemy.label = 'M';
    enemy.color = '#6d4c41';
    enemy.size = 42; // 56 * 75% (demande utilisateur explicite : tailles réduites à 75%)
    enemy.hpMax = TRAINING_DUMMY_HP;
    enemy.hp = TRAINING_DUMMY_HP;
    enemy.combatOverride = { melee: true, stat: 'force' };
    enemy.stats = { force: 0 };
    enemy.trainingDummy = true;
    enemy.bombAttack = null;
    enemy.stationary = false;
    enemy.flyingBombAttack = false;
    resetTransientCombatState(enemy);
    const spawn = clampPointToField({ size: enemy.size }, cx, cy - 220);
    enemy.x = spawn.x;
    enemy.y = spawn.y;
  }
  activeBombs = [];
  flyingBombs = [];

  resetPlayerCombatState();
  combatStats = createCombatStats();
  currentScene = 'combat';
}

// Expérience/niveau : valeurs provisoires (montant par victoire, seuil par niveau), à ajuster
// plus tard (demande utilisateur explicite) -- juste le mécanisme mis en place pour l'instant.
// Générique : marche aussi bien pour un personnage que pour un joueur, les deux n'ayant besoin
// que d'un .xp et d'un .level.
const VICTORY_XP = 20;

function xpToNextLevel(level) {
  return level * 100;
}

function grantXp(entity, amount) {
  entity.xp = (entity.xp || 0) + amount;
  while (entity.xp >= xpToNextLevel(entity.level)) {
    entity.xp -= xpToNextLevel(entity.level);
    entity.level += 1;
  }
}

// Détecte la fin du combat affiché -- victoire (boss à 0 PV) ou défaite (plus aucun personnage
// vivant) -- et bascule combatPhase sur l'écran de fin correspondant (voir drawCombatEndScreen).
// Débloque aussi le rond suivant et distribue l'XP de victoire (personnages ET joueurs, demande
// utilisateur explicite). Appelé à chaque image (voir loop()), mais combatOutcomeHandled évite de
// redéclencher tout ça en boucle tant qu'on n'a pas relancé un nouveau combat (voir enterCombatLevel).
function checkCombatOutcome() {
  if (currentScene !== 'combat' || combatOutcomeHandled || isTrainingCombat) return;
  const boss = enemies[0];
  if (!boss) return;

  if (boss.hp <= 0) {
    combatOutcomeHandled = true;
    combatPhase = 'victory';
    if (currentWorldLevel === worldProgress) {
      worldProgress = Math.min(worldProgress + 1, WORLD_LEVELS.length);
    }
    for (const character of characters) {
      if (character.playerControlled) grantXp(character, VICTORY_XP);
    }
    for (const player of players) grantXp(player, VICTORY_XP);
    grantVictoryLoot(); // 2 objets à chaque victoire (demande utilisateur explicite, voir plus haut)
    return;
  }

  if (combatPhase === 'active' && characters.every((c) => !c.playerControlled || c.hp <= 0)) {
    combatOutcomeHandled = true;
    combatPhase = 'defeat';
  }
}

function drawCheckmark(x, y, size) {
  ctx.strokeStyle = '#0b3d0b';
  ctx.lineWidth = Math.max(2, size * 0.16);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - size * 0.32, y);
  ctx.lineTo(x - size * 0.06, y + size * 0.28);
  ctx.lineTo(x + size * 0.36, y - size * 0.3);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

// Retire ou ajoute un personnage du roster au groupe actif (voir activePartyIndices) -- déjà 4
// sélectionnés : le tap est ignoré tant qu'on n'en a pas d'abord retiré un (pas de remplacement
// automatique, pour que ce soit un choix explicite). Ne prend effet en combat qu'au prochain
// donjon lancé (voir applyActivePartyToCombatSlots, appelé par resetCombatEncounter).
function toggleGuildMembership(character) {
  const idx = activePartyIndices.indexOf(character.rosterId);
  if (idx !== -1) {
    activePartyIndices.splice(idx, 1);
  } else if (activePartyIndices.length < PARTY_SIZE) {
    activePartyIndices.push(character.rosterId);
  }
}

// La scène "Guilde" a 3 sous-onglets (demande utilisateur explicite) : sélection du roster et
// gestion des comptes sont pleinement fonctionnelles ; "Stratégie d'équipe" reste pour l'instant
// un simple espace réservé, comme l'ont été les scènes principales avant d'avoir chacune leur tour
// un vrai contenu.
const GUILDE_SUB_TABS = [
  { key: 'roster', label: 'Sélection roster' },
  { key: 'comptes', label: 'Gestion des comptes' },
  { key: 'strategie', label: "Stratégie d'équipe" },
];
let guildeSubTab = 'roster';
const GUILDE_SUB_TAB_HEIGHT = 40;

// Sous-onglet "Gestion des comptes" : associe librement un joueur (parmi les 4) à un personnage
// du roster (parmi les 12) -- indépendant de la composition envoyée en donjon (voir "Sélection
// roster"), juste un registre de qui joue quel personnage (demande utilisateur explicite). Lignes
// ajoutées/supprimées librement, sans limite de nombre (demande utilisateur explicite : "on peut
// en avoir 0 ou 12"). Chaque menu déroulant ne propose que les joueurs/personnages pas déjà pris
// sur une autre ligne -- empêche les doublons directement dans la liste plutôt que d'échanger
// automatiquement (demande utilisateur explicite), "Aucun" toujours disponible pour vider une
// colonne.
let accountRows = [];
let nextAccountRowId = 1;
let openAccountDropdown = null; // { rowId, column: 'player' | 'character' }, ou null si rien n'est ouvert

function addAccountRow() {
  accountRows.push({ id: nextAccountRowId++, playerIndex: null, characterId: null });
}

function removeAccountRow(rowId) {
  accountRows = accountRows.filter((row) => row.id !== rowId);
  if (openAccountDropdown && openAccountDropdown.rowId === rowId) openAccountDropdown = null;
}

function availablePlayersForRow(rowId) {
  const usedElsewhere = new Set(accountRows.filter((row) => row.id !== rowId && row.playerIndex != null).map((row) => row.playerIndex));
  return players.filter((p) => !usedElsewhere.has(p.index));
}

function availableCharactersForRow(rowId) {
  const usedElsewhere = new Set(accountRows.filter((row) => row.id !== rowId && row.characterId != null).map((row) => row.characterId));
  return roster.filter((c) => !usedElsewhere.has(c.rosterId));
}

function guildeSubTabRects() {
  const tabWidth = canvas.width / GUILDE_SUB_TABS.length;
  return GUILDE_SUB_TABS.map((tab, i) => ({
    tab: tab.key, label: tab.label, x: i * tabWidth, y: TOP_BANNER_HEIGHT, width: tabWidth, height: GUILDE_SUB_TAB_HEIGHT,
  }));
}

function drawGuildeSubTabs() {
  const rects = guildeSubTabRects();
  const fontSize = fittingFontSize(GUILDE_SUB_TABS.map((t) => t.label), rects[0].width - 8, 12, 8);

  ctx.fillStyle = '#ffffff0a';
  ctx.fillRect(0, TOP_BANNER_HEIGHT, canvas.width, GUILDE_SUB_TAB_HEIGHT);
  ctx.strokeStyle = '#ffffff22';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, TOP_BANNER_HEIGHT + GUILDE_SUB_TAB_HEIGHT);
  ctx.lineTo(canvas.width, TOP_BANNER_HEIGHT + GUILDE_SUB_TAB_HEIGHT);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const rect of rects) {
    const active = rect.tab === guildeSubTab;
    if (active) {
      ctx.fillStyle = '#ffd54f1a';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rect.x, rect.y + rect.height - 1);
      ctx.lineTo(rect.x + rect.width, rect.y + rect.height - 1);
      ctx.stroke();
    }
    ctx.font = active ? `bold ${fontSize}px sans-serif` : `${fontSize}px sans-serif`;
    ctx.fillStyle = active ? '#ffd54f' : '#ffffffaa';
    ctx.fillText(rect.label, rect.x + rect.width / 2, rect.y + rect.height / 2 + 1);
    registerHitRect(rect.x, rect.y, rect.width, rect.height, () => { guildeSubTab = rect.tab; });
  }
}

// Sous-onglet "Sélection roster" : choisit lesquels des 11 personnages du roster (4 au maximum)
// partent en donjon. Un tap sur une ligne bascule son appartenance au groupe.
function drawGuildeRosterTab() {
  const cardX = LIST_PADDING_X;
  const cardWidth = canvas.width - LIST_PADDING_X * 2;
  const viewTop = TOP_BANNER_HEIGHT + GUILDE_SUB_TAB_HEIGHT;
  let y = viewTop + 16 - getSceneScrollY('guilde');

  // Comme l'onglet Personnage (même bug, même correctif, demande utilisateur explicite) : le
  // contenu (bouton d'entraînement + 12 personnages) peut dépasser l'écran, découpé sous les
  // sous-onglets pour qu'une ligne partiellement scrollée ne s'affiche pas par-dessus.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, viewTop, canvas.width, canvas.height - viewTop);
  ctx.clip();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`Groupe pour le donjon : ${activePartyIndices.length}/${PARTY_SIZE}`, cardX, y + 14);
  y += 34;

  // Combat spécial contre un mannequin d'entraînement (PV énormes, n'attaque jamais) avec le
  // groupe actif actuel -- pratique pour tester son DPS sans risquer le groupe ni toucher à la
  // progression du Monde (voir enterTrainingCombat).
  const trainingButtonHeight = 40;
  ctx.fillStyle = '#37474f';
  ctx.fillRect(cardX, y, cardWidth, trainingButtonHeight);
  ctx.strokeStyle = '#ffd54f88';
  ctx.lineWidth = 1;
  ctx.strokeRect(cardX + 0.5, y + 0.5, cardWidth - 1, trainingButtonHeight - 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#ffd54f';
  ctx.fillText('Entraînement (mannequin)', cardX + cardWidth / 2, y + trainingButtonHeight / 2 + 1);
  registerHitRect(cardX, y, cardWidth, trainingButtonHeight, enterTrainingCombat);
  y += trainingButtonHeight + 16;

  const rowHeight = 50;
  for (const character of roster) {
    const inParty = activePartyIndices.includes(character.rosterId);

    ctx.fillStyle = inParty ? '#ffd54f1a' : '#ffffff0d';
    ctx.fillRect(cardX, y, cardWidth, rowHeight);
    ctx.strokeStyle = inParty ? '#ffd54f' : '#ffffff22';
    ctx.lineWidth = inParty ? 2 : 1;
    ctx.strokeRect(cardX + 0.5, y + 0.5, cardWidth - 1, rowHeight - 1);

    ctx.fillStyle = character.color;
    ctx.fillRect(cardX + CARD_PADDING, y + rowHeight / 2 - 8, 16, 16);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${character.className}  ·  Niv. ${character.level}`, cardX + CARD_PADDING + 24, y + rowHeight / 2);

    if (inParty) {
      drawCheckmark(cardX + cardWidth - 22, y + rowHeight / 2, 18);
    } else {
      ctx.textAlign = 'right';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillStyle = '#ffffff44';
      ctx.fillText('+', cardX + cardWidth - 16, y + rowHeight / 2 + 5);
      ctx.textAlign = 'left';
    }
    ctx.textBaseline = 'alphabetic';

    registerHitRect(cardX, y, cardWidth, rowHeight, () => toggleGuildMembership(character));

    y += rowHeight + 6;
  }

  ctx.restore();

  setSceneContentHeight('guilde', y + getSceneScrollY('guilde') - viewTop);
  drawSceneScrollbar('guilde', viewTop);
}

// Un champ "menu déroulant" du sous-onglet Gestion des comptes : affiche la sélection actuelle (ou
// un texte d'invite grisé si vide) avec un petit ▾, et ouvre openAccountDropdown au clic.
function drawAccountDropdownBox(x, y, width, height, label, placeholder, onClick) {
  ctx.fillStyle = '#ffffff14';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = '#ffffff33';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = label ? 'bold 12px sans-serif' : '12px sans-serif';
  ctx.fillStyle = label ? '#ffffff' : '#ffffff66';
  ctx.fillText(label || placeholder, x + 8, y + height / 2 + 1, width - 24);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff88';
  ctx.font = '10px sans-serif';
  ctx.fillText('▾', x + width - 8, y + height / 2 + 1);
  ctx.textAlign = 'left';

  registerHitRect(x, y, width, height, onClick);
}

// Menu déroulant ouvert (voir openAccountDropdown) : plein écran par-dessus tout le reste -- plus
// simple et fiable qu'un menu ancré (pas de débordement à calculer), cohérent avec les autres
// superpositions déjà dans le jeu (voir drawCombatEndScreen). Touche n'importe où en dehors d'une
// option pour fermer sans rien changer.
function drawAccountDropdownOverlay() {
  const { rowId, column } = openAccountDropdown;
  const options = column === 'player'
    ? availablePlayersForRow(rowId).map((p) => ({ value: p.index, label: p.name }))
    : availableCharactersForRow(rowId).map((c) => ({ value: c.rosterId, label: c.className, color: c.color }));

  ctx.fillStyle = 'rgba(8, 10, 13, 0.92)';
  ctx.fillRect(0, TOP_BANNER_HEIGHT, canvas.width, canvas.height - TOP_BANNER_HEIGHT);
  registerHitRect(0, TOP_BANNER_HEIGHT, canvas.width, canvas.height - TOP_BANNER_HEIGHT, () => { openAccountDropdown = null; });

  const cardX = LIST_PADDING_X;
  const cardWidth = canvas.width - LIST_PADDING_X * 2;
  const panelY = TOP_BANNER_HEIGHT + 16;
  const headerHeight = 40;
  const rowHeight = 40;
  const panelHeight = headerHeight + (options.length + 1) * rowHeight + 10;

  ctx.fillStyle = '#1b232b';
  ctx.fillRect(cardX, panelY, cardWidth, panelHeight);
  ctx.strokeStyle = '#ffd54f88';
  ctx.lineWidth = 1;
  ctx.strokeRect(cardX + 0.5, panelY + 0.5, cardWidth - 1, panelHeight - 1);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#ffd54f';
  ctx.fillText(column === 'player' ? 'Choisir un joueur' : 'Choisir un personnage', cardX + CARD_PADDING, panelY + headerHeight / 2);

  let optY = panelY + headerHeight;
  const applySelection = (value) => {
    const row = accountRows.find((r) => r.id === rowId);
    if (row) row[column === 'player' ? 'playerIndex' : 'characterId'] = value;
    openAccountDropdown = null;
  };

  ctx.fillStyle = '#ffffff0d';
  ctx.fillRect(cardX, optY, cardWidth, rowHeight);
  ctx.strokeStyle = '#ffffff22';
  ctx.lineWidth = 1;
  ctx.strokeRect(cardX + 0.5, optY + 0.5, cardWidth - 1, rowHeight - 1);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#ffffff99';
  ctx.fillText('Aucun', cardX + CARD_PADDING, optY + rowHeight / 2 + 1);
  registerHitRect(cardX, optY, cardWidth, rowHeight, () => applySelection(null));
  optY += rowHeight;

  for (const option of options) {
    ctx.fillStyle = '#ffffff0d';
    ctx.fillRect(cardX, optY, cardWidth, rowHeight);
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 1;
    ctx.strokeRect(cardX + 0.5, optY + 0.5, cardWidth - 1, rowHeight - 1);

    let textX = cardX + CARD_PADDING;
    if (option.color) {
      ctx.fillStyle = option.color;
      ctx.fillRect(textX, optY + rowHeight / 2 - 7, 14, 14);
      textX += 22;
    }
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(option.label, textX, optY + rowHeight / 2 + 1);

    registerHitRect(cardX, optY, cardWidth, rowHeight, () => applySelection(option.value));
    optY += rowHeight;
  }
}

// Sous-onglet "Gestion des comptes" : une ligne par association, 2 colonnes en menu déroulant
// (joueur, personnage -- voir drawAccountDropdownBox/drawAccountDropdownOverlay) plus un bouton de
// suppression. "+ Ajouter une association" en bas crée une ligne vide.
function drawGuildeAccountsTab() {
  const cardX = LIST_PADDING_X;
  const cardWidth = canvas.width - LIST_PADDING_X * 2;
  const viewTop = TOP_BANNER_HEIGHT + GUILDE_SUB_TAB_HEIGHT;
  let y = viewTop + 16 - getSceneScrollY('guilde');

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, viewTop, canvas.width, canvas.height - viewTop);
  ctx.clip();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`Associations : ${accountRows.length}`, cardX, y + 14);
  y += 34;

  const rowHeight = 64;
  const deleteButtonSize = 28;
  const gap = 8;
  const colWidth = (cardWidth - deleteButtonSize - gap * 2 - 16) / 2;

  for (const row of accountRows) {
    ctx.fillStyle = '#ffffff0d';
    ctx.fillRect(cardX, y, cardWidth, rowHeight);
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 1;
    ctx.strokeRect(cardX + 0.5, y + 0.5, cardWidth - 1, rowHeight - 1);

    const boxY = y + (rowHeight - 32) / 2;
    const player = row.playerIndex != null ? players.find((p) => p.index === row.playerIndex) : null;
    const character = row.characterId != null ? roster.find((c) => c.rosterId === row.characterId) : null;

    drawAccountDropdownBox(cardX + 8, boxY, colWidth, 32, player ? player.name : '', 'Choisir un joueur', () => {
      openAccountDropdown = { rowId: row.id, column: 'player' };
    });
    drawAccountDropdownBox(cardX + 8 + colWidth + gap, boxY, colWidth, 32, character ? character.className : '', 'Choisir un personnage', () => {
      openAccountDropdown = { rowId: row.id, column: 'character' };
    });

    const delX = cardX + cardWidth - deleteButtonSize - 8;
    const delY = y + (rowHeight - deleteButtonSize) / 2;
    ctx.fillStyle = '#4a1f1f';
    ctx.fillRect(delX, delY, deleteButtonSize, deleteButtonSize);
    ctx.strokeStyle = '#ef535088';
    ctx.lineWidth = 1;
    ctx.strokeRect(delX + 0.5, delY + 0.5, deleteButtonSize - 1, deleteButtonSize - 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#ef5350';
    ctx.fillText('✕', delX + deleteButtonSize / 2, delY + deleteButtonSize / 2 + 1);
    registerHitRect(delX, delY, deleteButtonSize, deleteButtonSize, () => removeAccountRow(row.id));

    y += rowHeight + 8;
  }

  const addButtonHeight = 40;
  ctx.fillStyle = '#37474f';
  ctx.fillRect(cardX, y, cardWidth, addButtonHeight);
  ctx.strokeStyle = '#ffd54f88';
  ctx.lineWidth = 1;
  ctx.strokeRect(cardX + 0.5, y + 0.5, cardWidth - 1, addButtonHeight - 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#ffd54f';
  ctx.fillText('+ Ajouter une association', cardX + cardWidth / 2, y + addButtonHeight / 2 + 1);
  registerHitRect(cardX, y, cardWidth, addButtonHeight, addAccountRow);
  y += addButtonHeight + 16;

  ctx.restore();

  setSceneContentHeight('guilde', y + getSceneScrollY('guilde') - viewTop);
  drawSceneScrollbar('guilde', viewTop);

  if (openAccountDropdown) drawAccountDropdownOverlay();
}

// Sous-onglets pas encore implémentés : simple espace réservé, comme les scènes principales
// avant d'avoir leur tour un vrai contenu.
function drawGuildePlaceholderTab(label) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = '#ffffff55';
  const top = TOP_BANNER_HEIGHT + GUILDE_SUB_TAB_HEIGHT;
  ctx.fillText(label, canvas.width / 2, top + (canvas.height - top) / 2);
}

function drawGuildeScene() {
  drawGuildeSubTabs();
  if (guildeSubTab === 'roster') {
    drawGuildeRosterTab();
  } else if (guildeSubTab === 'comptes') {
    drawGuildeAccountsTab();
  } else {
    drawGuildePlaceholderTab("Stratégie d'équipe");
  }
}

function drawWorldScene() {
  const positions = worldLevelPositions();

  ctx.strokeStyle = '#ffffff33';
  ctx.lineWidth = 4;
  ctx.beginPath();
  positions.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();

  for (const p of positions) {
    const completed = p.index < worldProgress;
    const current = p.index === worldProgress;
    const locked = p.index > worldProgress;
    const radius = p.level.isBoss ? 34 : 26;

    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = completed ? '#66bb6a' : current ? (p.level.isBoss ? '#e53935' : '#ffd54f') : '#3a3f45';
    ctx.fill();
    ctx.lineWidth = current ? 4 : 2;
    ctx.strokeStyle = current ? '#ffffff' : '#00000055';
    ctx.stroke();

    if (completed) {
      drawCheckmark(p.x, p.y, radius);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(radius * 0.8)}px sans-serif`;
      ctx.fillStyle = locked ? '#ffffff55' : '#101010';
      ctx.fillText(p.level.label, p.x, p.y + 1);
    }

    if (!locked) {
      registerHitRect(p.x - radius, p.y - radius, radius * 2, radius * 2, () => enterCombatLevel(p.index));
    }
  }
}

// Scènes pas encore implémentées : simple espace réservé (comme le tout premier placeholder
// "SCRPG"), en attendant leur contenu.
function drawPlaceholderScene(sceneKey) {
  const scene = SCENES.find((s) => s.key === sceneKey);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = '#ffffff55';
  ctx.fillText(scene.label, canvas.width / 2, TOP_BANNER_HEIGHT + (canvas.height - TOP_BANNER_HEIGHT) / 2);
}

function draw() {
  ctx.fillStyle = '#10151a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  interactiveRects = [];
  hoverRects = [];

  if (currentScene === 'combat') {
    drawCombatBackground();
    for (const enemy of enemies) {
      if (enemy.flyingBombAttack) drawArtificierProximityZone(enemy);
    }
    for (const bomb of activeBombs) drawBomb(bomb, performance.now());
    for (const character of characters) drawCharacter(character);
    for (const character of characters) {
      if (character.playerControlled) drawCharacterBars(character);
    }
    for (const enemy of enemies) drawEnemyHealthBar(enemy);
    for (const bomb of flyingBombs) drawFlyingBomb(bomb);
    for (const character of characters) {
      if (character.hp <= 0) continue; // rien à montrer sur un cadavre
      const bottomY = character.playerControlled
        ? character.y - character.size / 2 - 8
        : character.y - character.size / 2 - 48; // au-dessus du nom/barre de vie déjà affichés
      drawStatusBadges(character, bottomY);
    }
    if (isTrainingCombat && combatPhase !== 'victory' && combatPhase !== 'defeat') {
      drawDpsHud(performance.now());
      drawTrainingExitButton();
    }

    // Trait pointillé de l'ennemi vers sa cible (voir updateEnemyAI) -- juste pour que le joueur
    // comprenne qui il poursuit, ne pilote aucune logique.
    for (const enemy of enemies) {
      if (!enemy.attackTarget || enemy.attackTarget.hp <= 0) continue;
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = '#ff525299';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(enemy.x, enemy.y);
      ctx.lineTo(enemy.attackTarget.x, enemy.attackTarget.y);
      ctx.stroke();
      ctx.restore();
    }

    // Pendant un drag : soit on survole un ennemi (ordre d'attaque, voir pointermove) et on
    // l'entoure en rouge pour indiquer clairement la cible, soit trajet de déplacement habituel
    // (avec détours éventuels) jusqu'à la destination ajustée, et rond (plus épais que le trait)
    // au point de relâche final.
    if (dragging && activeTarget && dragTargetEnemy) {
      const half = dragTargetEnemy.size / 2;
      ctx.strokeStyle = '#ff5252';
      ctx.lineWidth = 4;
      ctx.strokeRect(dragTargetEnemy.x - half - 8, dragTargetEnemy.y - half - 8, dragTargetEnemy.size + 16, dragTargetEnemy.size + 16);

      ctx.strokeStyle = '#ff5252aa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(activeTarget.x, activeTarget.y);
      ctx.lineTo(dragTargetEnemy.x, dragTargetEnemy.y);
      ctx.stroke();
    } else if (dragging && activeTarget && dragPreviewPath.length > 0) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(activeTarget.x, activeTarget.y);
      for (const p of dragPreviewPath) ctx.lineTo(p.x, p.y);
      ctx.stroke();

      const finalPoint = dragPreviewPath[dragPreviewPath.length - 1];
      ctx.beginPath();
      ctx.arc(finalPoint.x, finalPoint.y, 10, 0, Math.PI * 2);
      ctx.lineWidth = 5;
      ctx.stroke();
    }

    drawSkillEffects(performance.now());
    drawFloatingTexts(performance.now());

    if (combatPhase === 'victory' || combatPhase === 'defeat') {
      drawCombatEndScreen(performance.now());
    } else {
      drawPullOverlay(performance.now());
      if (threatPanelEnemy) drawThreatPanel(threatPanelEnemy, performance.now());

      const selected = characters.find((c) => c.selected);
      if (selected) drawSelectionBanner(selected);
    }
  } else if (currentScene === 'joueur') {
    drawPlayerScene();
  } else if (currentScene === 'personnage') {
    drawCharacterScene();
    if (hoveredSkillsCharacter) drawSkillsTooltip(hoveredSkillsCharacter);
  } else if (currentScene === 'monde') {
    drawWorldScene();
  } else if (currentScene === 'guilde') {
    drawGuildeScene();
  } else {
    drawPlaceholderScene(currentScene);
  }

  drawTopBanner();

  // Numéro de version (voir js/version.js) : tout petit, en bas à gauche, purement informatif --
  // même emplacement/style que le projet migration (GameScene.js), incrémenté automatiquement à
  // chaque publication (voir publish-web.ps1).
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#ffffff99';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillText('v' + GameVersion, 6, canvas.height - 4);
}

let lastFrameTime = performance.now();

function loop(now) {
  // Plafonné à 100ms : après un onglet mis en veille ou un gros hoquet, un dt énorme ferait
  // franchir tout le chemin (et donc plusieurs personnages) d'un coup au prochain calcul.
  const dt = Math.min(now - lastFrameTime, 100);
  lastFrameTime = now;

  // Écran de fin affiché (voir drawCombatEndScreen) : plus aucune simulation tant qu'on reste
  // dessus -- sinon, en entraînement, le mannequin continue d'encaisser des coups après "Quitter"
  // (demande utilisateur explicite : "il faudrait que le combat se mette en pause"), et chaque
  // coup relance combatPhase sur 'active' (voir dealDamage), faisant disparaître le résumé presque
  // aussitôt affiché. "Continuer" (voir drawCombatEndScreen) repasse juste combatPhase à 'active'
  // pour reprendre exactement là où on s'était arrêté (PV/mana/cooldowns intacts).
  const combatPaused = combatPhase === 'victory' || combatPhase === 'defeat';
  if (!combatPaused) {
    if (combatPhase === 'countdown' && now >= pullCountdownEndAt) {
      combatPhase = 'active';
      combatActiveStartAt = now;
    }

    for (const enemy of enemies) updateEnemyAI(enemy, now);
    for (const character of characters) {
      if (character.playerControlled) updateAutoPlay(character);
    }
    for (const character of characters) updateMove(character, dt);
    resolveOverlaps();
    for (const character of characters) {
      updateCombat(character, now);
      updateDotEffects(character, now);
      updatePyroBurn(character, now);
      updateRempartStacks(character, now);
      updateShield(character, now);
      updateManaRegen(character, dt);
    }
    updateBombs(now);
    updateFlyingBombs(dt, now);
  }
  updateFloatingTexts(now);
  updateSkillEffects(now);
  checkCombatOutcome();
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
