(function (scope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else scope.MobileNavigation = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  const LINK_SELECTOR = 'nav a[data-page], .settings-link[data-page]';
  const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, label, summary, dialog, img, video, audio, canvas, iframe, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"], [data-no-swipe]';
  const AXIS_THRESHOLD = 10;
  const SWIPE_THRESHOLD = 60;
  const EDGE_GUTTER = 20;

  function create({ root, content, navigate, isBlocked = () => false, mediaQuery = '(max-width: 580px)' }) {
    if (!root || !content || typeof navigate !== 'function') throw new TypeError('Mobile navigation requires root, content, and navigate.');
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    const media = win.matchMedia(mediaQuery);
    const pointers = new Set();
    const listeners = [];
    let gesture = null;
    let suppressedClick = null;
    let draggedPointer = null;
    let destroyed = false;

    function listen(target, name, listener, options) {
      target.addEventListener(name, listener, options);
      listeners.push(() => target.removeEventListener(name, listener, options));
    }

    function visibleLinks() {
      return Array.from(root.querySelectorAll(LINK_SELECTOR)).filter(link => {
        const rect = link.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && link.getAttribute('aria-disabled') !== 'true' && !link.hidden;
      });
    }

    function activeLink(links) {
      return links.find(link => link.getAttribute('aria-current') === 'page' || link.classList.contains('active'));
    }

    function clearPreview() {
      root.classList.remove('is-dragging');
      root.querySelectorAll('.drag-preview').forEach(link => link.classList.remove('drag-preview'));
    }

    function placeIndicator(link) {
      if (!link) {
        root.classList.remove('has-nav-indicator');
        return;
      }
      const rect = link.getBoundingClientRect();
      const container = root.getBoundingClientRect();
      root.style.setProperty('--nav-indicator-x', `${rect.left - container.left - (root.clientLeft || 0)}px`);
      root.style.setProperty('--nav-indicator-width', `${rect.width}px`);
      root.classList.add('has-nav-indicator');
    }

    function restoreIndicator() {
      clearPreview();
      placeIndicator(!destroyed && media.matches ? activeLink(visibleLinks()) : null);
    }

    function cancel() {
      gesture = null;
      restoreIndicator();
    }

    function sync() {
      // Rendering can replace every anchor, so never hold a preview across renders.
      cancel();
    }

    function preview(link) {
      clearPreview();
      if (!link) return;
      root.classList.add('is-dragging');
      link.classList.add('drag-preview');
      placeIndicator(link);
    }

    function linkAt(x, y, links) {
      return links.find(link => {
        const rect = link.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      });
    }

    function selectedText() {
      const selection = win.getSelection && win.getSelection();
      return selection && !selection.isCollapsed;
    }

    function ignoreContentTarget(target) {
      if (target.closest(INTERACTIVE_SELECTOR) || selectedText()) return true;
      for (let node = target; node && node !== content; node = node.parentElement) {
        const style = win.getComputedStyle(node);
        const horizontal = /auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
        const vertical = /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
        if (horizontal || vertical) return true;
      }
      return false;
    }

    function onPointerDown(event) {
      // A new real press must never inherit the click suppression of an earlier drag.
      suppressedClick = null;
      if (!pointers.size) draggedPointer = null;
      pointers.add(event.pointerId);
      if (!media.matches || isBlocked() || event.isPrimary === false || pointers.size > 1) {
        cancel();
        return;
      }
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target && (event.target.nodeType === 1 ? event.target : event.target.parentElement);
      if (!target || typeof target.closest !== 'function') return;
      const links = visibleLinks();
      if (links.length < 2) return;
      const origin = { id: event.pointerId, x: event.clientX, y: event.clientY, links, horizontal: false, candidate: null };
      if (root.contains(target)) {
        const link = links.find(item => item.contains(target));
        if (link) gesture = { ...origin, kind: 'nav', startLink: link };
      } else if (content.contains(target) && !ignoreContentTarget(target)) {
        const width = doc.documentElement.clientWidth || win.innerWidth;
        if (event.clientX <= EDGE_GUTTER || event.clientX >= width - EDGE_GUTTER) return;
        const index = links.indexOf(activeLink(links));
        if (index >= 0) gesture = { ...origin, kind: 'content', index };
      }
    }

    function candidateFor(state, event) {
      if (state.kind === 'nav') return linkAt(event.clientX, event.clientY, state.links);
      const dx = event.clientX - state.x;
      return state.links[state.index + (dx < 0 ? 1 : -1)];
    }

    function onPointerMove(event) {
      if (!gesture || gesture.id !== event.pointerId) return;
      if (!media.matches || isBlocked() || pointers.size > 1) {
        cancel();
        return;
      }
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      const x = Math.abs(dx), y = Math.abs(dy);
      if (!gesture.horizontal) {
        if (x < AXIS_THRESHOLD && y < AXIS_THRESHOLD) return;
        // Vertical or diagonal intent belongs to the browser's native scrolling.
        if (x <= y * 1.3) {
          cancel();
          return;
        }
        gesture.horizontal = true;
        if (gesture.kind === 'nav') draggedPointer = event.pointerId;
      }
      if (y > Math.max(28, x * 0.65)) {
        cancel();
        return;
      }
      if (gesture.kind === 'nav') {
        const rect = root.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
          cancel();
          return;
        }
      }
      gesture.candidate = candidateFor(gesture, event);
      preview(gesture.candidate);
      if (event.cancelable) event.preventDefault();
    }

    function onPointerUp(event) {
      pointers.delete(event.pointerId);
      if (draggedPointer === event.pointerId) {
        suppressedClick = { pointerId: event.pointerId, until: Date.now() + 600 };
        draggedPointer = null;
      }
      if (!gesture || gesture.id !== event.pointerId) return;
      const state = gesture;
      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      const candidate = candidateFor(state, event);
      const moved = state.horizontal;
      const valid = moved && media.matches && !isBlocked() && Math.abs(dy) <= Math.max(28, Math.abs(dx) * 0.65)
        && (state.kind === 'nav' || (Math.abs(dx) >= SWIPE_THRESHOLD && !selectedText()));
      cancel();
      if (!moved) return; // Ordinary taps keep their native anchor/keyboard behavior.
      if (event.cancelable) event.preventDefault();
      if (!valid || !candidate || candidate === activeLink(visibleLinks()) || !root.contains(candidate)) return;
      const href = candidate.getAttribute('href');
      if (!href || href[0] !== '#') return;
      // Routing owns unsaved-change prompts. Always restore from actual active state.
      try {
        const result = navigate(href);
        if (result && typeof result.then === 'function') result.then(sync, sync);
      } finally {
        sync();
      }
    }

    function onPointerCancel(event) {
      pointers.delete(event.pointerId);
      if (draggedPointer === event.pointerId) draggedPointer = null;
      if (gesture && gesture.id === event.pointerId) cancel();
    }

    function onClick(event) {
      if (!suppressedClick || !event.detail || Date.now() > suppressedClick.until) return;
      if (event.pointerId !== undefined && event.pointerId !== suppressedClick.pointerId && event.pointerId !== -1) return;
      suppressedClick = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function reset() {
      pointers.clear();
      suppressedClick = null;
      draggedPointer = null;
      cancel();
    }

    listen(doc, 'pointerdown', onPointerDown, true);
    listen(doc, 'pointermove', onPointerMove, { passive: false });
    listen(doc, 'pointerup', onPointerUp);
    listen(doc, 'pointercancel', onPointerCancel);
    listen(root, 'click', onClick, true);
    listen(win, 'resize', sync);
    listen(win, 'orientationchange', reset);
    listen(win, 'blur', reset);
    listen(doc, 'visibilitychange', reset);
    if (media.addEventListener) listen(media, 'change', reset);
    else {
      media.addListener(reset);
      listeners.push(() => media.removeListener(reset));
    }
    sync();

    return {
      sync,
      cancel,
      destroy() {
        destroyed = true;
        reset();
        listeners.forEach(remove => remove());
        root.style.removeProperty('--nav-indicator-x');
        root.style.removeProperty('--nav-indicator-width');
      }
    };
  }

  return { create };
});
