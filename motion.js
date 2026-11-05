/** Small, dependency-free motion primitives. No permanent inline styles are set. */
const numberStates = new WeakMap();
const entranceSlots = new WeakMap();
const dialogSlots = new WeakMap();
const pressSlots = new WeakMap();
const feedbackRoots = new WeakMap();
const running = new Set();
const noop = () => {};
const defaultFormat = value => String(Math.round(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const springEase = 'cubic-bezier(0.16, 1, 0.3, 1)';
let reducedQuery;
try { reducedQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'); } catch { /* Optional browser API. */ }

/** Hidden documents and reduced-motion preferences settle directly to the end. */
export function motionAllowed() {
  return !reducedQuery?.matches && globalThis.document?.visibilityState !== 'hidden';
}

function settleIfNeeded() {
  if (!motionAllowed()) for (const controller of [...running]) controller.finish();
}
if (reducedQuery?.addEventListener) reducedQuery.addEventListener('change', settleIfNeeded);
else reducedQuery?.addListener?.(settleIfNeeded);
globalThis.document?.addEventListener?.('visibilitychange', settleIfNeeded);

function visual(element) {
  let style;
  try { style = globalThis.getComputedStyle?.(element); } catch { /* Detached elements can have no computed style. */ }
  const opacity = Number.parseFloat(style?.opacity ?? '1');
  return {
    transform: style?.transform && style.transform !== 'none' ? style.transform : '',
    opacity: Number.isFinite(opacity) ? opacity : 1,
    scale: style?.scale && style.scale !== 'none' ? style.scale : '1',
  };
}
const transform = (base, extra = '') => `${base} ${extra}`.trim() || 'none';

/** Cancel before measuring the unanimated destination; keep the current frame. */
function replaceSlot(slots, element) {
  const previous = element && slots.get(element);
  const current = previous ? visual(element) : null;
  previous?.cancel();
  return current;
}

/** All completion paths clean up fill effects; cancellation never calls finish. */
function play(element, slots, keyframes, options, onFinish = noop) {
  slots.get(element)?.cancel();
  if (!element || typeof element.animate !== 'function' || !motionAllowed() || element.isConnected === false) {
    onFinish();
    return null;
  }
  let animation;
  try {
    animation = element.animate(keyframes, {...options, fill:'both', composite:'replace'});
  } catch {
    onFinish();
    return null;
  }
  let settled = false;
  const settle = complete => {
    if (settled) return;
    settled = true;
    animation.onfinish = null;
    animation.oncancel = null;
    running.delete(controller);
    if (slots.get(element) === controller) slots.delete(element);
    // Removing the animation restores the existing stylesheet, not a frozen frame.
    try { animation.cancel(); } catch { /* An already removed effect needs no work. */ }
    if (complete) onFinish();
  };
  const controller = {animation, cancel:() => settle(false), finish:() => settle(true)};
  slots.set(element, controller);
  running.add(controller);
  animation.onfinish = controller.finish;
  animation.oncancel = controller.cancel;
  return controller;
}

/**
 * Animate numeric text from its last displayed numeric value. Repeated identical
 * targets reuse the running animation, so frequent renders never restart it.
 * Returns a {cancel, finish} controller, or null for an invalid target/element.
 */
export function animateNumber(element, target, {format = defaultFormat, duration = 650} = {}) {
  if (!element || !('textContent' in element)) return null;
  let destination;
  try { destination = Number(target); } catch { return null; }
  if (!Number.isFinite(destination)) return null;
  const formatter = typeof format === 'function' ? format : defaultFormat;
  const previous = numberStates.get(element);
  if (previous?.running && previous.target === destination && motionAllowed()) {
    previous.format = formatter;
    return previous.controller;
  }
  const initial = previous?.value ?? 0;
  previous?.controller.cancel();
  const record = {value:initial, target:destination, format:formatter, frame:null, running:false, controller:null};
  numberStates.set(element, record);
  const write = value => {
    let text;
    try { text = String(record.format(value)); } catch { text = defaultFormat(value); }
    element.textContent = text;
  };
  const stop = finish => {
    if (record.frame !== null) globalThis.cancelAnimationFrame?.(record.frame);
    record.frame = null;
    record.running = false;
    running.delete(controller);
    if (finish && numberStates.get(element) === record) {
      record.value = destination;
      write(destination);
    }
  };
  const controller = {cancel:() => stop(false), finish:() => stop(true)};
  record.controller = controller;
  const time = clamp(finite(duration, 650), 0, 3000);
  if (!motionAllowed() || typeof globalThis.requestAnimationFrame !== 'function' || time === 0 || initial === destination || element.isConnected === false) {
    controller.finish();
    return controller;
  }
  let startedAt = null;
  const tick = now => {
    if (!record.running || numberStates.get(element) !== record) return;
    if (!motionAllowed() || element.isConnected === false) { controller.finish(); return; }
    if (startedAt === null) startedAt = now;
    const progress = clamp((now - startedAt) / time, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 4);
    record.value = initial + (destination - initial) * eased;
    write(record.value);
    if (progress === 1) controller.finish();
    else record.frame = globalThis.requestAnimationFrame(tick);
  };
  record.running = true;
  running.add(controller);
  write(initial);
  record.frame = globalThis.requestAnimationFrame(tick);
  return controller;
}

/** A soft entrance, with transform and opacity as its only animated properties. */
export function springIn(element, {delay = 0, distance = 20, scale = .97, duration = 600} = {}) {
  if (!element) return null;
  const current = replaceSlot(entranceSlots, element);
  const base = visual(element);
  const travel = clamp(finite(distance, 20), -200, 200);
  const startScale = clamp(finite(scale, .97), .1, 1.2);
  return play(element, entranceSlots, [
    {opacity:current?.opacity ?? 0, transform:current ? transform(current.transform) : transform(base.transform, `translate3d(0, ${travel}px, 0) scale(${startScale})`), offset:0},
    {opacity:base.opacity, transform:transform(base.transform, `translate3d(0, ${-travel * .035}px, 0) scale(1.003)`), offset:.76},
    {opacity:base.opacity, transform:transform(base.transform), offset:1},
  ], {duration:clamp(finite(duration, 600), 0, 1500), delay:clamp(finite(delay, 0), 0, 1500), easing:springEase});
}

function scaleBy(value, multiplier) {
  const parts = String(value).trim().split(/\s+/).map(part => part.endsWith('%') ? Number.parseFloat(part) / 100 : Number(part));
  return parts.length && parts.every(Number.isFinite) ? parts.map(part => part * multiplier).join(' ') : String(multiplier);
}

/**
 * Delegated pointer/keyboard feedback. The scale longhand preserves a button's
 * existing transform; older browsers use its computed transform as their base.
 * Returns a cleanup function. Calling twice on one root does not add listeners.
 */
export function pressFeedback(root = globalThis.document) {
  if (!root?.addEventListener) return noop;
  if (feedbackRoots.has(root)) return feedbackRoots.get(root);
  const press = event => {
    if (!motionAllowed()) return;
    if (event.type === 'pointerdown' && (event.isPrimary === false || event.button > 0)) return;
    if (event.type === 'keydown' && (event.repeat || (event.key !== 'Enter' && event.key !== ' '))) return;
    const target = event.target?.closest ? event.target : event.target?.parentElement;
    const button = target?.closest?.('button, [role="button"]');
    if (!button || (root.contains && !root.contains(button)) || button.matches(':disabled') || button.getAttribute('aria-disabled') === 'true') return;
    const current = replaceSlot(pressSlots, button);
    const base = visual(button);
    const keyframes = button.style && 'scale' in button.style ? [
      {scale:current?.scale ?? base.scale, offset:0},
      {scale:scaleBy(base.scale, .96), offset:.32},
      {scale:base.scale, offset:1},
    ] : [
      {transform:transform(current?.transform ?? base.transform), offset:0},
      {transform:transform(base.transform, 'scale(.96)'), offset:.32},
      {transform:transform(base.transform), offset:1},
    ];
    play(button, pressSlots, keyframes, {duration:220, easing:'cubic-bezier(0.2, 0.7, 0.3, 1)'});
  };
  root.addEventListener('pointerdown', press, {passive:true});
  root.addEventListener('keydown', press);
  const cleanup = () => {
    root.removeEventListener('pointerdown', press);
    root.removeEventListener('keydown', press);
    feedbackRoots.delete(root);
  };
  feedbackRoots.set(root, cleanup);
  return cleanup;
}

function rectangle(origin) {
  let rect;
  try { rect = typeof origin?.getBoundingClientRect === 'function' ? origin.getBoundingClientRect() : origin; }
  catch { return null; }
  if (!rect || ![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)) return null;
  return rect;
}

/**
 * Call after showModal(). Origin may be an element or a DOMRect. Opening and
 * closing share a slot, so reopening cancels any pending close callback.
 */
export function morphDialog(dialog, origin) {
  if (!dialog) return null;
  const current = replaceSlot(dialogSlots, dialog);
  const base = visual(dialog);
  const destination = rectangle(dialog), source = rectangle(origin);
  let dx = 0, dy = 24, initialScale = .965;
  if (source && destination && destination.width > 0 && destination.height > 0) {
    dx = source.left + source.width / 2 - destination.left - destination.width / 2;
    dy = source.top + source.height / 2 - destination.top - destination.height / 2;
    // Keep the content's aspect ratio while expanding from the activating control.
    initialScale = clamp(Math.max(source.width / destination.width, source.height / destination.height), .16, .965);
  }
  return play(dialog, dialogSlots, [
    {opacity:current?.opacity ?? 0, transform:current ? transform(current.transform) : transform(base.transform, `translate3d(${dx}px, ${dy}px, 0) scale(${initialScale})`), offset:0},
    {opacity:base.opacity, transform:transform(base.transform, `translate3d(${-dx * .012}px, ${-dy * .012}px, 0) scale(1.007)`), offset:.78},
    {opacity:base.opacity, transform:transform(base.transform), offset:1},
  ], {duration:460, easing:springEase});
}

/** Latest dismissal wins; cancellation/reopening never invokes a stale callback. */
export function dismissDialog(dialog, callback = noop) {
  const done = typeof callback === 'function' ? callback : noop;
  if (!dialog) { done(); return null; }
  const current = replaceSlot(dialogSlots, dialog);
  const base = visual(dialog);
  return play(dialog, dialogSlots, [
    {opacity:current?.opacity ?? base.opacity, transform:transform(current?.transform ?? base.transform)},
    {opacity:0, transform:transform(base.transform, 'translate3d(0, 32px, 0) scale(.97)')},
  ], {duration:170, easing:'cubic-bezier(0.4, 0, 1, 1)'}, done);
}

/** One staggered, 600 ms entrance per primary surface; returns its controllers. */
export function introSequence(root = globalThis.document) {
  if (!root?.querySelectorAll) return [];
  const selectors = ['.topbar', '.planner-panel', '.map-search-wrap', '.result-card', '.project-card'];
  const controllers = [];
  selectors.forEach((selector, index) => {
    const elements = [...root.querySelectorAll(selector)];
    if (root.matches?.(selector)) elements.unshift(root);
    for (const element of elements) {
      const controller = springIn(element, {delay:index * 80, duration:600, distance:index === 0 ? -12 : 20, scale:index === 0 ? .995 : .975});
      if (controller) controllers.push(controller);
    }
  });
  return controllers;
}
