import { render } from '@testing-library/react';
import BackgroundSky from '../components/BackgroundSky';

// jsdom draws nothing: a stand-in 2D context records the calls, and animation frames are counted
const fakeContext = () => ({
  setTransform: jest.fn(), clearRect: jest.fn(), beginPath: jest.fn(), arc: jest.fn(), fill: jest.fn(),
  moveTo: jest.fn(), lineTo: jest.fn(), stroke: jest.fn(), fillText: jest.fn(),
  createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
});

let ctx;
const original = { raf: window.requestAnimationFrame, caf: window.cancelAnimationFrame, matchMedia: window.matchMedia };

const reducedMotion = (matches) => {
  window.matchMedia = jest.fn(() => ({ matches, addEventListener: jest.fn(), removeEventListener: jest.fn() }));
};

beforeEach(() => {
  ctx = fakeContext();
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
  window.requestAnimationFrame = jest.fn(() => 7);
  window.cancelAnimationFrame = jest.fn();
  reducedMotion(false);
});

afterEach(() => {
  jest.restoreAllMocks();
  window.requestAnimationFrame = original.raf;
  window.cancelAnimationFrame = original.caf;
  window.matchMedia = original.matchMedia;
});

test('a canvas behind the page that screen readers skip', () => {
  const { container } = render(<BackgroundSky />);
  expect(container.querySelector('canvas.background-sky')).toHaveAttribute('aria-hidden', 'true');
});

test('it draws the stars and emojis, then keeps animating', () => {
  render(<BackgroundSky />);
  expect(ctx.arc).toHaveBeenCalled();         // stars
  expect(ctx.fillText).toHaveBeenCalled();    // emojis
  expect(window.requestAnimationFrame).toHaveBeenCalled();
});

test('for anyone who asks for reduced motion it draws one still frame', () => {
  reducedMotion(true);
  render(<BackgroundSky />);
  expect(ctx.fillText).toHaveBeenCalled();
  expect(window.requestAnimationFrame).not.toHaveBeenCalled();
});

test('it stops animating when it goes away', () => {
  const { unmount } = render(<BackgroundSky />);
  unmount();
  expect(window.cancelAnimationFrame).toHaveBeenCalledWith(7);
});

test("without canvas support it draws nothing and doesn't break", () => {
  HTMLCanvasElement.prototype.getContext.mockImplementation(() => null);
  const { container } = render(<BackgroundSky />);
  expect(container.querySelector('canvas.background-sky')).toBeInTheDocument();
  expect(window.requestAnimationFrame).not.toHaveBeenCalled();
});
