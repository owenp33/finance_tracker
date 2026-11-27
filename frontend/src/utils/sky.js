// The background sky (components/BackgroundSky): twinkling stars, shooting stars and money emojis drifting
// across, behind the cards. Pure: where everything is and how it moves, in pixels and seconds; the
// component draws it. `random` is passed in (Math.random by default) so tests can fix it.

// How fast it all moves: Owen picked 2.5× from the live previews (2026-11-27)
export const SKY_SPEED = 2.5;
export const SKY_EMOJI = ['💸', '💰', '📈', '🪙', '💵', '🤑', '🍞'];

const STAR_AREA = 7000;        // one star per this many square pixels
const COIN_SPACING = 150;      // one emoji per this many pixels of width
const MIN_COINS = 5;

const between = (random, low, high) => low + random() * (high - low);

// An emoji: anywhere across the screen when the sky is first seeded, else entering from the left edge
function newCoin(width, height, random, anywhere) {
  const size = between(random, 18, 38);
  return {
    emoji: SKY_EMOJI[Math.floor(random() * SKY_EMOJI.length)],
    x: anywhere ? between(random, -40, width) : -50,
    y: between(random, 20, Math.max(20, height - 20)),
    size,
    vx: between(random, 18, 42) * (size / 30),      // bigger ones drift faster, as if nearer
    bob: between(random, 4, 12),                     // how far it bobs up and down
    phase: between(random, 0, Math.PI * 2),
    alpha: between(random, 0.55, 0.9),
  };
}

// A shooting star: from the top edge or the upper left, heading down and to the right
function newMeteor(width, height, random) {
  const fromTop = random() < 0.6;
  const speed = between(random, 520, 820);
  const angle = between(random, 0.35, 0.6);         // radians below horizontal
  return {
    x: fromTop ? between(random, width * 0.1, width * 0.9) : between(random, -40, width * 0.3),
    y: fromTop ? between(random, -40, height * 0.2) : between(random, 0, height * 0.5),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    age: 0,
    life: between(random, 0.7, 1.2),                 // seconds until it has faded out
    length: between(random, 90, 170),                // its tail, in pixels
    lime: random() < 0.5,
  };
}

// A sky for a screen this size: stars by its area, emojis by its width, no shooting star yet (the first
// is due at once)
export function seedSky(width, height, random = Math.random) {
  return {
    width,
    height,
    stars: Array.from({ length: Math.round((width * height) / STAR_AREA) }, () => ({
      x: between(random, 0, width),
      y: between(random, 0, height),
      r: between(random, 0.4, 1.4),
      phase: between(random, 0, Math.PI * 2),
      twinkle: between(random, 0.6, 1.8),
      lime: random() < 0.25,
    })),
    coins: Array.from({ length: Math.max(MIN_COINS, Math.round(width / COIN_SPACING)) },
      () => newCoin(width, height, random, true)),
    meteors: [],
    nextMeteorAt: 0,
  };
}

// The sky `dt` seconds on, at time `now` (seconds): emojis drift right and re-enter from the left once
// past the right edge; shooting stars move, age and go once faded or off the screen; a new one starts
// when one is due, the next due 1.2–2.8 seconds later (divided by the speed)
export function stepSky(sky, dt, now, random = Math.random) {
  const { width, height } = sky;
  const coins = sky.coins.map(c => {
    const x = c.x + c.vx * dt * SKY_SPEED;
    return x > width + 50 ? newCoin(width, height, random, false) : { ...c, x };
  });
  const meteors = sky.meteors
    .map(m => ({ ...m, age: m.age + dt, x: m.x + m.vx * dt * SKY_SPEED, y: m.y + m.vy * dt * SKY_SPEED }))
    .filter(m => m.age < m.life && m.x < width + 200 && m.y < height + 200);
  let { nextMeteorAt } = sky;
  if (now >= nextMeteorAt) {
    meteors.push(newMeteor(width, height, random));
    nextMeteorAt = now + between(random, 1.2, 2.8) / SKY_SPEED;
  }
  return { ...sky, coins, meteors, nextMeteorAt };
}
