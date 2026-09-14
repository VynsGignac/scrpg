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
    stats, hp: hpMax, hpMax, mana: manaMax, manaMax,
  });

  players.push({
    index: i + 1,
    name: chosenNames[i],
    level: randomInt(1, 100),
    skills: { apm: randomInt(0, 5), connaissanceJeu: randomInt(0, 5) },
  });
}

// Boss : plus gros, pas contrôlable par le joueur, a une barre de vie (voir drawEnemyHealthBar).
// Choisit un personnage au hasard à sa première action et le poursuit/attaque pendant tout le
// combat (voir updateBossAI) -- ne change jamais de cible.
const BOSS_HP_MAX = 200;
const bossSpawn = clampPointToField({ size: ENEMY_SIZE }, cx, cy - 220);
characters.push({
  x: bossSpawn.x, y: bossSpawn.y, size: ENEMY_SIZE, color: '#c62828', selected: false, isMoving: false,
  playerControlled: false, hp: BOSS_HP_MAX, hpMax: BOSS_HP_MAX,
  facingAngle: Math.PI / 2, // tourné vers le bas (zone de départ des personnages) -- voir Coup sournois
  stats: { force: 24 }, // seule stat nécessaire : reprend le calcul de dégâts générique (updateCombat)
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
const ATTACK_INTERVAL_MS = 1200;

function combatProfile(character) {
  return CLASS_COMBAT[character.className] || DEFAULT_COMBAT;
}

function hitTestEnemyAt(x, y) {
  return enemies.find((e) => isInsideCharacter(e, x, y)) || null;
}

function orderAttack(character, enemy) {
  character.attackTarget = enemy;
  const combat = combatProfile(character);
  const dist = Math.hypot(character.x - enemy.x, character.y - enemy.y) || 1;
  const dirX = (character.x - enemy.x) / dist;
  const dirY = (character.y - enemy.y) / dist;

  if (combat.melee) {
    // Vise un point légèrement à l'intérieur de l'ennemi, dans la direction réelle du
    // personnage (pas pile le centre) : resolveDestination le ramène de toute façon au contact,
    // mais viser EXACTEMENT le centre est un cas à égalité parfaite entre les 4 bords, qui
    // retombait donc toujours sur "à gauche de l'ennemi" quelle que soit la position de départ.
    const nudge = Math.min(enemy.size / 2 - 1, 20);
    startMove(character, enemy.x + dirX * nudge, enemy.y + dirY * nudge);
    return;
  }

  if (dist > RANGED_ATTACK_RANGE) {
    startMove(character, enemy.x + dirX * RANGED_ATTACK_RANGE, enemy.y + dirY * RANGED_ATTACK_RANGE);
  }
  // Sinon déjà à portée : pas de déplacement, l'attaque commence sur place (voir updateCombat).
}

// IA du boss : choisit un personnage au hasard dès sa première évaluation et le garde comme
// cible pour tout le combat (jamais de changement de cible tant qu'il est vivant). Marche vers
// lui (corps à corps, comme un personnage sans sort à distance) tant qu'il n'est pas à portée --
// comme la cible peut elle-même se déplacer entre-temps, le boss recalcule sa route à chaque
// fois qu'il arrive quelque part sans être encore à portée, plutôt qu'une seule fois au départ.
function updateBossAI(boss, now) {
  if (!boss.attackTarget) {
    const alivePlayers = characters.filter((c) => c.playerControlled && c.hp > 0);
    if (alivePlayers.length === 0) return;
    boss.attackTarget = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
  }

  const target = boss.attackTarget;
  if (boss.isMoving || isInRangeOf(boss, target)) return;

  const dist = Math.hypot(boss.x - target.x, boss.y - target.y) || 1;
  const dirX = (boss.x - target.x) / dist;
  const dirY = (boss.y - target.y) / dist;
  const nudge = Math.min(target.size / 2 - 1, 20);
  startMove(boss, target.x + dirX * nudge, target.y + dirY * nudge);
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
  if (character.selected) return;

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
  // Riposte passive, sans déplacement : un personnage du joueur sans cible qui a déjà un ennemi
  // à portée l'attaque sans qu'un ordre explicite soit nécessaire -- qu'il soit sélectionné ou
  // non (la poursuite ACTIVE, avec déplacement, reste elle réservée aux non-sélectionnés, voir
  // updateAutoPlay). Une cible existante n'est jamais remplacée ici : "tant qu'une autre cible
  // n'a pas été définie" (ordre explicite du joueur, ou updateAutoPlay).
  if (character.playerControlled && !character.attackTarget) {
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
  dealDamage(target, damage, '255, 112, 67');
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
// puis affiche le nombre flottant correspondant.
function dealDamage(target, amount, rgb) {
  let remaining = amount;
  if (target.shieldHp > 0) {
    const absorbed = Math.min(target.shieldHp, remaining);
    target.shieldHp -= absorbed;
    remaining -= absorbed;
  }
  target.hp = Math.max(0, target.hp - remaining);
  spawnFloatingText(target.x + (Math.random() - 0.5) * 24, target.y - target.size / 2 - 34, `-${amount}`, rgb);
}

function healCharacter(target, amount) {
  target.hp = Math.min(target.hpMax, target.hp + amount);
  spawnFloatingText(target.x + (Math.random() - 0.5) * 24, target.y - target.size / 2 - 34, `+${amount}`, '129, 199, 132');
}

// Effet à tick (brûlure/saignement) : inflige damagePerTick toutes les tickIntervalMs, ticksLeft
// fois, indépendamment de qui l'a posé (le lanceur n'a plus besoin d'être présent/en vie).
function applyDot(target, spec) {
  if (!target.dotEffects) target.dotEffects = [];
  target.dotEffects.push({ ...spec, nextTickAt: performance.now() + spec.tickIntervalMs });
}

function updateDotEffects(character, now) {
  if (!character.dotEffects || character.dotEffects.length === 0) return;
  for (let i = character.dotEffects.length - 1; i >= 0; i--) {
    const dot = character.dotEffects[i];
    if (now >= dot.nextTickAt) {
      dealDamage(character, dot.damagePerTick, dot.rgb);
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
  const players_ = characters.filter((c) => c.playerControlled);
  if (players_.length === 0) return null;
  return players_.reduce((worst, c) => (c.hp / c.hpMax < worst.hp / worst.hpMax ? c : worst));
}

const SKILLS = {
  bouleDeFeu: {
    id: 'bouleDeFeu', name: 'Boule de feu', shortLabel: 'Boule\nde feu', targeting: 'enemy', cooldownMs: 4000,
    cast(character, target) {
      const damage = 10 + Math.round(character.stats.intelligence * 0.8);
      dealDamage(target, damage, '255, 112, 67');
      applyDot(target, {
        kind: 'burn', ticksLeft: 3, tickIntervalMs: 1000, rgb: '255, 87, 34',
        damagePerTick: 3 + Math.round(character.stats.intelligence * 0.2),
      });
    },
  },
  traitDeGivre: {
    id: 'traitDeGivre', name: 'Trait de givre', shortLabel: 'Trait de\ngivre', targeting: 'enemy', cooldownMs: 3000,
    cast(character, target) {
      const damage = 8 + Math.round(character.stats.intelligence * 0.6);
      dealDamage(target, damage, '79, 195, 247');
      // Ralentit les déplacements de la cible -- sans effet visible sur le boss actuel, qui ne
      // se déplace jamais, mais prêt pour un futur ennemi mobile.
      target.slowMultiplier = 0.5;
      target.slowUntil = performance.now() + 3000;
    },
  },
  coupSournois: {
    id: 'coupSournois', name: 'Coup sournois', shortLabel: 'Coup\nsournois', targeting: 'enemy', cooldownMs: 3000,
    cast(character, target) {
      const base = 8 + Math.round(character.stats.agilite * 0.8);
      const damage = isBehind(character, target) ? base * 2 : base;
      dealDamage(target, damage, '186, 104, 200');
    },
  },
  surinage: {
    id: 'surinage', name: 'Surinage', shortLabel: 'Surinage', targeting: 'enemy', cooldownMs: 3500,
    cast(character, target) {
      const damage = 6 + Math.round(character.stats.agilite * 0.5);
      dealDamage(target, damage, '229, 57, 53');
      applyDot(target, {
        kind: 'bleed', ticksLeft: 4, tickIntervalMs: 800, rgb: '229, 57, 53',
        damagePerTick: 2 + Math.round(character.stats.agilite * 0.15),
      });
    },
  },
  lumiereDivine: {
    id: 'lumiereDivine', name: 'Lumière divine', shortLabel: 'Lumière\ndivine', targeting: 'ally', cooldownMs: 6000,
    cast(character) {
      const heal = 15 + Math.round(character.stats.savoir * 0.6);
      healCharacter(lowestHpAlly() || character, heal);
    },
  },
  murSacre: {
    id: 'murSacre', name: 'Mur sacré', shortLabel: 'Mur\nsacré', targeting: 'self', cooldownMs: 8000,
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
  const minY = TOP_BANNER_HEIGHT + half;
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

// L'adversaire (playerControlled: false) n'est ni sélectionnable ni déplaçable par le joueur.
function hitTestCharacter(x, y) {
  for (let i = characters.length - 1; i >= 0; i--) {
    const c = characters[i];
    if (c.playerControlled && isInsideCharacter(c, x, y)) return c;
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
  // l'ennemi, donnant l'impression à tort qu'on ne peut pas viser dessus.
  dragTargetEnemy = hitTestEnemyAt(x, y);
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

      // Terminer le drag SUR un ennemi = ordre d'attaque plutôt qu'un simple déplacement.
      const targetEnemy = hitTestEnemyAt(x, y);
      if (targetEnemy) {
        orderAttack(activeTarget, targetEnemy);
      } else {
        activeTarget.attackTarget = null; // un nouvel ordre de déplacement annule un combat en cours
        startMove(activeTarget, x, y);
      }
    }
  } else if (dist <= CLICK_THRESHOLD) {
    deselectAll(); // clic dans le vide : désélectionne tout
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
  ctx.fillStyle = character.color;
  ctx.fillRect(character.x - half, character.y - half, character.size, character.size);

  // Bouclier actif (Mur sacré) : fin liseré bleuté autour du personnage tant qu'il tient.
  if (character.shieldHp > 0) {
    ctx.strokeStyle = '#80d8ffcc';
    ctx.lineWidth = 3;
    ctx.strokeRect(character.x - half - 3, character.y - half - 3, character.size + 6, character.size + 6);
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

  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#ffffffcc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${Math.max(enemy.hp, 0)}/${enemy.hpMax}`, enemy.x, barY - 3);
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
  const readyAt = (character.cooldowns && character.cooldowns[skill.id]) || 0;
  const remaining = Math.max(0, readyAt - now);
  const onCooldown = remaining > 0;

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
    const frac = remaining / skill.cooldownMs;
    ctx.fillStyle = '#00000099';
    ctx.fillRect(slotX, slotY, slotSize, slotSize * frac);
    ctx.font = `bold ${Math.max(10, Math.round(slotSize * 0.28))}px sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(Math.ceil(remaining / 1000)), slotX + slotSize / 2, slotY + slotSize / 2);
  }
  ctx.restore();

  ctx.strokeStyle = '#ffffff55';
  ctx.lineWidth = 1;
  ctx.strokeRect(slotX + 0.5, slotY + 0.5, slotSize - 1, slotSize - 1);

  registerHitRect(slotX, slotY, slotSize, slotSize, () => castSkill(character, skill.id));
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

    // Trait pointillé du boss vers sa cible (voir updateBossAI) -- juste pour que le joueur
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

    const selected = characters.find((c) => c.selected);
    if (selected) drawSelectionBanner(selected);
  } else if (currentScene === 'joueur') {
    drawPlayerScene();
  } else if (currentScene === 'personnage') {
    drawCharacterScene();
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

  for (const enemy of enemies) updateBossAI(enemy, now);
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
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
