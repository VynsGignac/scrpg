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

// Bandeau de navigation en haut de l'écran, toujours visible quelle que soit la scène active :
// un bouton par scène. Pour l'instant seule "Combat" a un vrai contenu (le prototype de
// déplacement/collision ci-dessous) ; les autres sont de simples pages vides en attendant.
const TOP_BANNER_HEIGHT = 56;
const SCENES = [
  { key: 'combat', label: 'Combat' },
  { key: 'joueur', label: 'Joueur' },
  { key: 'personnage', label: 'Personnage' },
  { key: 'guilde', label: 'Guilde' },
  { key: 'monde', label: 'Monde' },
];
let currentScene = 'combat';

const CHARACTER_SIZE = 48;
const ENEMY_SIZE = 72;
// Marge supplémentaire (au-delà du strict contact bord à bord) laissée entre deux personnages.
const AVOID_MARGIN = 4;

const cx = window.innerWidth / 2;
const cy = window.innerHeight / 2;
const SPACING = 140;

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
// Limité aux 3 classes qui ont des compétences définies (voir SKILLS/CLASS_SKILLS) -- Guerrier,
// Archère et Barbare reviendront quand leurs sorts seront définis à leur tour.
const CHARACTER_CLASSES = ['Mage', 'Voleur', 'Paladin'];
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

function randomCharacterStats() {
  return {
    force: randomInt(3, 18),
    agilite: randomInt(3, 18),
    endurance: randomInt(3, 18),
    intelligence: randomInt(3, 18),
    savoir: randomInt(3, 18),
  };
}

const squareColors = ['#4fc3f7', '#ff8a65', '#aed581'];
const squareXs = [cx - SPACING, cx, cx + SPACING];
const chosenClasses = shuffle(CHARACTER_CLASSES).slice(0, 3);
const chosenNames = shuffle(FIRST_NAMES).slice(0, 3);

const players = [];
const characters = [];

for (let i = 0; i < 3; i++) {
  const stats = randomCharacterStats();
  // PV/mana dérivés des caractéristiques (endurance/intelligence) plutôt que des valeurs fixes,
  // pour rester cohérents avec la classe et les stats désormais aléatoires du personnage.
  const hpMax = 30 + stats.endurance * 4;
  const manaMax = 10 + stats.intelligence * 4;

  characters.push({
    x: squareXs[i], y: cy, size: CHARACTER_SIZE, color: squareColors[i], selected: false, isMoving: false,
    playerControlled: true, index: i + 1, className: chosenClasses[i], level: randomInt(1, 100),
    label: chosenClasses[i].charAt(0), // ex. "M" pour Mage -- affiché sur le carré (voir drawCharacter)
    stats, hp: hpMax, hpMax, mana: manaMax, manaMax, threat: 0, lastThreatAt: 0,
  });

  players.push({
    index: i + 1,
    name: chosenNames[i],
    level: randomInt(1, 100),
    skills: { apm: randomInt(0, 5), connaissanceJeu: randomInt(0, 5) },
  });
}

// Les 5 combats de la carte du Monde (voir drawWorldScene) : un seul emplacement d'ennemi existe
// dans le jeu (characters[3]), reconfiguré à chaque rond choisi (voir resetCombatEncounter) --
// taille, PV, couleur, dégâts (melee ou à distance) et lettre affichée sur le carré changent,
// pas le reste du moteur de combat (évitement, riposte passive, etc., déjà génériques).
const ENCOUNTERS = [
  { name: 'Gobelin', label: 'G', color: '#8bc34a', size: 44, hpMax: 250, statValue: 10, combat: { melee: true, stat: 'force' } },
  { name: 'Archer squelette', label: 'A', color: '#cfd8dc', size: 52, hpMax: 400, statValue: 16, combat: { melee: false, stat: 'force' } },
  { name: 'Brute orque', label: 'O', color: '#795548', size: 64, hpMax: 800, statValue: 26, combat: { melee: true, stat: 'force' } },
  { name: 'Sorcière', label: 'S', color: '#ab47bc', size: 50, hpMax: 600, statValue: 22, combat: { melee: false, stat: 'force' } },
  { name: 'Seigneur des ombres', label: 'B', color: '#c62828', size: 76, hpMax: 5000, statValue: 30, combat: { melee: true, stat: 'force' }, isBoss: true },
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

const PIXELS_PER_MS = 0.09; // vitesse de déplacement des personnages (constante sur tout le trajet)

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
const CLASS_COMBAT = {
  Guerrier: { melee: true, stat: 'force' },
  Paladin: { melee: true, stat: 'force' },
  Barbare: { melee: true, stat: 'force' },
  Voleur: { melee: true, stat: 'agilite' },
  Mage: { melee: false, stat: 'intelligence' },
  Archère: { melee: false, stat: 'agilite' },
};
const DEFAULT_COMBAT = { melee: true, stat: 'force' };
const RANGED_ATTACK_RANGE = 220;
const ATTACK_INTERVAL_MS = 2000;

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

function hitTestEnemyAt(x, y) {
  return enemies.find((e) => e.hp > 0 && isInsideCharacter(e, x, y)) || null;
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
  } else if (dist > RANGED_ATTACK_RANGE) {
    startMove(attacker, target.x + dirX * RANGED_ATTACK_RANGE, target.y + dirY * RANGED_ATTACK_RANGE);
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

// IA d'un ennemi (voir ENCOUNTERS) : attaque le personnage qui a le plus de menace vis-à-vis de
// lui (voir highestThreatPlayer) -- peut donc changer de cible en cours de combat si quelqu'un
// d'autre prend l'aggro. Tant que personne n'a encore généré de menace (tout juste engagé), une
// cible aléatoire de repli est choisie UNE FOIS et gardée telle quelle (sinon, en tirant au sort
// à chaque image tant que tout le monde est à 0, il changerait d'avis en permanence sans jamais
// se décider à approcher qui que ce soit). S'approche pour attaquer (corps à corps ou à distance
// selon l'ennemi, voir approachForCombat) tant qu'il n'est pas à portée -- comme la cible peut
// elle-même se déplacer entre-temps, il recalcule sa route à chaque fois qu'il arrive quelque
// part sans être à portée.
function updateEnemyAI(enemy, now) {
  if (enemy.hp <= 0 || combatPhase !== 'active') return;

  const alivePlayers = characters.filter((c) => c.playerControlled && c.hp > 0);
  if (alivePlayers.length === 0) return;

  const { best, bestThreat } = highestThreatPlayer(now);
  if (best && bestThreat > 0) {
    enemy.attackTarget = best;
  } else if (!enemy.attackTarget || enemy.attackTarget.hp <= 0) {
    enemy.attackTarget = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
  }

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

// "Jouent tout seuls" : un personnage NON sélectionné cherche activement l'ennemi le plus proche,
// s'approche pour l'attaquer (voir orderAttack, qui gère le déplacement) et utilise ses
// compétences dès qu'elles sont prêtes. Dès que le joueur le sélectionne, cette fonction ne fait
// plus rien pour lui -- il reprend uniquement les ordres du joueur (voir pointerup), plus la
// riposte passive sans déplacement gérée au début de updateCombat ci-dessous, commune à tous.
function updateAutoPlay(character) {
  if (character.selected || character.hp <= 0 || combatPhase !== 'active') return;

  const target = nearestEnemyTo(character);
  if (!target) return;

  // Nouvel engagement, ou cible déjà fixée mais hors de portée après être arrivé (elle a bougé
  // entre-temps) : (re)lance un ordre d'attaque, qui se charge lui-même de l'approche.
  if (character.attackTarget !== target || (!character.isMoving && !isInRangeOf(character, target))) {
    orderAttack(character, target);
  }

  for (const skillId of CLASS_SKILLS[character.className] || []) {
    castSkill(character, skillId);
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
  if (now - (character.lastAttackAt || 0) < ATTACK_INTERVAL_MS) return;

  character.lastAttackAt = now;
  const combat = combatProfile(character);
  const damage = 4 + Math.round((character.stats[combat.stat] || 10) / 3);
  dealDamage(target, damage, '255, 112, 67', character);
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

// ------------------------------------------------------------
// Compétences (voir bandeau de sélection, deux premières cases) : deux sorts par classe pour
// l'instant, un clic sur la case lance le sort (pas de visée séparée -- une seule cible possible
// pour l'instant, le boss, donc les sorts offensifs le visent automatiquement s'il est à portée).
// ------------------------------------------------------------

// Inflige des dégâts à "target" en consommant d'abord son éventuel bouclier (voir Mur sacré),
// puis affiche le nombre flottant correspondant. Le moindre dégât reçu par un ennemi démarre le
// combat pour de bon, même pendant le compte à rebours du pull (voir combatPhase en tête de
// fichier). Génère aussi de la menace (voir plus haut) : pour l'attaquant s'il tape un ennemi,
// pour la cible elle-même si c'est un ennemi qui la frappe -- "source" est facultatif (ex. les
// dégâts environnementaux n'en génèrent pas).
function dealDamage(target, amount, rgb, source) {
  if (!target.playerControlled && combatPhase !== 'active') combatPhase = 'active';

  let remaining = amount;
  if (target.shieldHp > 0) {
    const absorbed = Math.min(target.shieldHp, remaining);
    target.shieldHp -= absorbed;
    remaining -= absorbed;
  }
  target.hp = Math.max(0, target.hp - remaining);
  spawnFloatingText(target.x + (Math.random() - 0.5) * 24, target.y - target.size / 2 - 34, `-${amount}`, rgb);

  const now = performance.now();
  if (!target.playerControlled && source && source.playerControlled) {
    addThreat(source, amount, now); // le joueur inflige des dégâts à l'ennemi
  } else if (target.playerControlled && source && !source.playerControlled) {
    addThreat(target, amount, now); // le joueur subit des dégâts de l'ennemi
  }
}

// Soigner génère de la menace pour le soigneur, au même titre que les dégâts (demande
// utilisateur explicite) -- y compris en se soignant soi-même (source === target).
function healCharacter(target, amount, source) {
  target.hp = Math.min(target.hpMax, target.hp + amount);
  spawnFloatingText(target.x + (Math.random() - 0.5) * 24, target.y - target.size / 2 - 34, `+${amount}`, '129, 199, 132');
  if (source && source.playerControlled) addThreat(source, amount, performance.now());
}

// Effet à tick (brûlure/saignement) : inflige damagePerTick toutes les tickIntervalMs, ticksLeft
// fois. Garde une référence à qui l'a posé (spec.source) pour continuer à générer de la menace en
// son nom à chaque tick, même si le lanceur bouge ou fait autre chose entre-temps.
function applyDot(target, spec) {
  if (!target.dotEffects) target.dotEffects = [];
  target.dotEffects.push({ ...spec, nextTickAt: performance.now() + spec.tickIntervalMs });
}

function updateDotEffects(character, now) {
  if (!character.dotEffects || character.dotEffects.length === 0) return;
  for (let i = character.dotEffects.length - 1; i >= 0; i--) {
    const dot = character.dotEffects[i];
    if (now >= dot.nextTickAt) {
      dealDamage(character, dot.damagePerTick, dot.rgb, dot.source);
      dot.ticksLeft -= 1;
      dot.nextTickAt = now + dot.tickIntervalMs;
    }
    if (dot.ticksLeft <= 0) character.dotEffects.splice(i, 1);
  }
}

// Expire le bouclier de Mur sacré une fois sa durée écoulée (sa quantité de PV absorbés, elle,
// est déjà consommée au fil des coups reçus par dealDamage ci-dessus).
function updateShield(character, now) {
  if (character.shieldHp > 0 && now >= (character.shieldExpiresAt || 0)) {
    character.shieldHp = 0;
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

const SKILL_COOLDOWN_MS = 20000; // même recharge pour tous les sorts, demande utilisateur explicite

const SKILLS = {
  bouleDeFeu: {
    id: 'bouleDeFeu', name: 'Boule de feu', shortLabel: 'Boule\nde feu', targeting: 'enemy', cooldownMs: SKILL_COOLDOWN_MS,
    cast(character, target) {
      const damage = 10 + Math.round(character.stats.intelligence * 0.8);
      dealDamage(target, damage, '255, 112, 67', character);
      applyDot(target, {
        kind: 'burn', ticksLeft: 3, tickIntervalMs: 1000, rgb: '255, 87, 34', source: character,
        damagePerTick: 3 + Math.round(character.stats.intelligence * 0.2),
      });
    },
  },
  traitDeGivre: {
    id: 'traitDeGivre', name: 'Trait de givre', shortLabel: 'Trait de\ngivre', targeting: 'enemy', cooldownMs: SKILL_COOLDOWN_MS,
    cast(character, target) {
      const damage = 8 + Math.round(character.stats.intelligence * 0.6);
      dealDamage(target, damage, '79, 195, 247', character);
      // Ralentit les déplacements de la cible -- sans effet visible sur le boss actuel, qui ne
      // se déplace jamais, mais prêt pour un futur ennemi mobile.
      target.slowMultiplier = 0.5;
      target.slowUntil = performance.now() + 3000;
    },
  },
  coupSournois: {
    id: 'coupSournois', name: 'Coup sournois', shortLabel: 'Coup\nsournois', targeting: 'enemy', cooldownMs: SKILL_COOLDOWN_MS,
    cast(character, target) {
      const base = 8 + Math.round(character.stats.agilite * 0.8);
      const damage = isBehind(character, target) ? base * 2 : base;
      dealDamage(target, damage, '186, 104, 200', character);
    },
  },
  surinage: {
    id: 'surinage', name: 'Surinage', shortLabel: 'Surinage', targeting: 'enemy', cooldownMs: SKILL_COOLDOWN_MS,
    cast(character, target) {
      const damage = 6 + Math.round(character.stats.agilite * 0.5);
      dealDamage(target, damage, '229, 57, 53', character);
      applyDot(target, {
        kind: 'bleed', ticksLeft: 4, tickIntervalMs: 800, rgb: '229, 57, 53', source: character,
        damagePerTick: 2 + Math.round(character.stats.agilite * 0.15),
      });
    },
  },
  lumiereDivine: {
    id: 'lumiereDivine', name: 'Lumière divine', shortLabel: 'Lumière\ndivine', targeting: 'ally', cooldownMs: SKILL_COOLDOWN_MS,
    cast(character) {
      const heal = 15 + Math.round(character.stats.savoir * 0.6);
      healCharacter(lowestHpAlly() || character, heal, character);
    },
  },
  murSacre: {
    id: 'murSacre', name: 'Mur sacré', shortLabel: 'Mur\nsacré', targeting: 'self', cooldownMs: SKILL_COOLDOWN_MS,
    cast(character) {
      const shield = 20 + Math.round(character.stats.force * 1.2);
      character.shieldHp = shield;
      character.shieldMax = shield;
      character.shieldExpiresAt = performance.now() + 6000;
    },
  },
};

const CLASS_SKILLS = {
  Mage: ['bouleDeFeu', 'traitDeGivre'],
  Paladin: ['lumiereDivine', 'murSacre'],
  Voleur: ['coupSournois', 'surinage'],
};

// Même critère de "à portée" que l'attaque de base (voir updateCombat) : corps à corps = juste à
// côté, distance = dans RANGED_ATTACK_RANGE. Utilisé pour autoriser ou non un sort offensif --
// contrairement à un ordre d'attaque, lancer un sort ne fait pas marcher le personnage vers sa
// cible, il faut déjà être en position.
function isInRangeOf(character, target) {
  const combat = combatProfile(character);
  const dist = Math.hypot(character.x - target.x, character.y - target.y);
  return combat.melee ? dist <= avoidHalfExtent(character, target) + 20 : dist <= RANGED_ATTACK_RANGE + 20;
}

function castSkill(character, skillId) {
  if (character.hp <= 0 || combatPhase === 'prePull') return; // mort, ou pull pas encore lancé
  const skill = SKILLS[skillId];
  if (!skill) return;

  const now = performance.now();
  const readyAt = (character.cooldowns && character.cooldowns[skillId]) || 0;
  if (now < readyAt) return;

  if (skill.targeting === 'enemy') {
    const target = enemies[0];
    if (!target || target.hp <= 0 || !isInRangeOf(character, target)) return;
    skill.cast(character, target);
  } else {
    skill.cast(character);
  }

  if (!character.cooldowns) character.cooldowns = {};
  character.cooldowns[skillId] = now + skill.cooldownMs;
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
  let remaining = PIXELS_PER_MS * dt;

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

  // Zones interactives de la scène affichée (jauges de compétence du joueur, cases de sort du
  // bandeau de sélection en combat...) : prioritaires sur la sélection/déplacement ci-dessous,
  // sinon cliquer une case de sort en combat serait interprété comme un clic dans le vide.
  const hit = hitTestInteractiveRects(x, y);
  if (hit) {
    hit.onClick();
    return;
  }

  // Hors de la scène "combat", il n'y a pas de personnages à sélectionner/déplacer.
  if (currentScene !== 'combat') return;

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

canvas.addEventListener('pointerup', (event) => {
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
// Filet de sécurité : si l'app passe en arrière-plan (changement d'app, verrouillage...) pendant
// un drag, on ne reçoit pas forcément de pointerup/pointercancel propre.
window.addEventListener('blur', clearPointerState);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearPointerState();
});

function drawCharacter(character) {
  const half = character.size / 2;
  if (character.selected) {
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 4;
    ctx.strokeRect(character.x - half - 6, character.y - half - 6, character.size + 12, character.size + 12);
  }
  const dead = character.hp <= 0;
  ctx.fillStyle = dead ? '#4a4a4a' : character.color;
  ctx.fillRect(character.x - half, character.y - half, character.size, character.size);

  // Bouclier actif (Mur sacré) : fin liseré bleuté autour du personnage tant qu'il tient.
  if (!dead && character.shieldHp > 0) {
    ctx.strokeStyle = '#80d8ffcc';
    ctx.lineWidth = 3;
    ctx.strokeRect(character.x - half - 3, character.y - half - 3, character.size + 6, character.size + 6);
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
  } else if (character.label) {
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
  ctx.fillText(`Mana ${character.mana}/${character.manaMax}`, colX, rowY);
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
  const cardHeight = 140;
  let y = TOP_BANNER_HEIGHT + 16;

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

    let rowY = y + CARD_PADDING + 28;
    rowY = drawSkillRow(player, 'apm', 'APM', cardX + CARD_PADDING, rowY, cardWidth - CARD_PADDING * 2);
    drawSkillRow(player, 'connaissanceJeu', 'Connaissance du jeu', cardX + CARD_PADDING, rowY, cardWidth - CARD_PADDING * 2);

    y += cardHeight + CARD_GAP;
  }
}

// Scène "Personnage" : la liste des personnages loués (classe, niveau, caractéristiques). Simple
// affichage pour l'instant -- pas encore de points à répartir ici, contrairement aux compétences
// du joueur ci-dessus.
function drawCharacterScene() {
  const cardX = LIST_PADDING_X;
  const cardWidth = canvas.width - LIST_PADDING_X * 2;
  const cardHeight = 150;
  let y = TOP_BANNER_HEIGHT + 16;

  const STAT_MAX = 20;
  const statRows = [
    ['Force', 'force'],
    ['Agilité', 'agilite'],
    ['Endurance', 'endurance'],
    ['Intelligence', 'intelligence'],
    ['Savoir', 'savoir'],
  ];

  for (const character of characters.filter((c) => c.playerControlled)) {
    const player = players.find((p) => p.index === character.index);

    ctx.fillStyle = '#ffffff0d';
    ctx.fillRect(cardX, y, cardWidth, cardHeight);
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 1;
    ctx.strokeRect(cardX + 0.5, y + 0.5, cardWidth - 1, cardHeight - 1);

    ctx.fillStyle = character.color;
    ctx.fillRect(cardX + CARD_PADDING, y + CARD_PADDING - 1, 14, 14);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${character.className}  ·  Niveau ${character.level}`, cardX + CARD_PADDING + 22, y + CARD_PADDING + 11);

    if (player) {
      ctx.textAlign = 'right';
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#ffffffaa';
      ctx.fillText(`Loué par ${player.name}`, cardX + cardWidth - CARD_PADDING, y + CARD_PADDING + 11);
      ctx.textAlign = 'left';
    }

    const labelWidth = 90;
    const valueColWidth = 28;
    const barX = cardX + CARD_PADDING + labelWidth;
    const barWidth = cardWidth - CARD_PADDING * 2 - labelWidth - valueColWidth;

    let rowY = y + CARD_PADDING + 28;
    for (const [label, key] of statRows) {
      const value = character.stats[key];
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#ffffffcc';
      ctx.fillText(label, cardX + CARD_PADDING, rowY + 9);

      ctx.fillStyle = '#ffffff14';
      ctx.fillRect(barX, rowY, barWidth, 10);
      ctx.fillStyle = character.color;
      ctx.fillRect(barX, rowY, barWidth * Math.min(value / STAT_MAX, 1), 10);

      ctx.textAlign = 'right';
      ctx.fillText(String(value), cardX + cardWidth - CARD_PADDING, rowY + 9);
      ctx.textAlign = 'left';

      rowY += 20;
    }

    y += cardHeight + CARD_GAP;
  }
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
    enemy.attackTarget = null;
    enemy.dotEffects = [];
    enemy.isMoving = false;
    enemy.pathPoints = [];
    const spawn = clampPointToField({ size: encounter.size }, cx, cy - 220);
    enemy.x = spawn.x;
    enemy.y = spawn.y;
  }

  let i = 0;
  for (const character of characters) {
    if (!character.playerControlled) continue;
    character.hp = character.hpMax;
    character.mana = character.manaMax;
    character.shieldHp = 0;
    character.cooldowns = {};
    character.dotEffects = [];
    character.attackTarget = null;
    character.threat = 0;
    character.lastThreatAt = 0;
    character.isMoving = false;
    character.pathPoints = [];
    character.selected = false;
    character.x = squareXs[i];
    character.y = cy;
    i += 1;
  }
}

function enterCombatLevel(index) {
  currentWorldLevel = index;
  combatOutcomeHandled = false;
  combatPhase = 'prePull';
  threatPanelEnemy = null;
  resetCombatEncounter(index);
  currentScene = 'combat';
}

// Débloque le rond suivant dès que le boss du combat affiché tombe à 0 PV -- appelé à chaque
// image (voir loop()), mais combatOutcomeHandled évite de ré-incrémenter worldProgress en boucle
// tant qu'on n'a pas relancé un nouveau combat (voir enterCombatLevel).
function checkCombatOutcome() {
  if (currentScene !== 'combat' || combatOutcomeHandled) return;
  const boss = enemies[0];
  if (!boss || boss.hp > 0) return;

  combatOutcomeHandled = true;
  if (currentWorldLevel === worldProgress) {
    worldProgress = Math.min(worldProgress + 1, WORLD_LEVELS.length);
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

  if (currentScene === 'combat') {
    for (const character of characters) drawCharacter(character);
    for (const enemy of enemies) drawEnemyHealthBar(enemy);

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

    drawFloatingTexts(performance.now());
    drawPullOverlay(performance.now());
    if (threatPanelEnemy) drawThreatPanel(threatPanelEnemy, performance.now());

    const selected = characters.find((c) => c.selected);
    if (selected) drawSelectionBanner(selected);
  } else if (currentScene === 'joueur') {
    drawPlayerScene();
  } else if (currentScene === 'personnage') {
    drawCharacterScene();
  } else if (currentScene === 'monde') {
    drawWorldScene();
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

  if (combatPhase === 'countdown' && now >= pullCountdownEndAt) combatPhase = 'active';

  for (const enemy of enemies) updateEnemyAI(enemy, now);
  for (const character of characters) {
    if (character.playerControlled) updateAutoPlay(character);
  }
  for (const character of characters) updateMove(character, dt);
  resolveOverlaps();
  for (const character of characters) {
    updateCombat(character, now);
    updateDotEffects(character, now);
    updateShield(character, now);
  }
  updateFloatingTexts(now);
  checkCombatOutcome();
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
