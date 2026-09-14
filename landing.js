// landing.js
//
// This file belongs ONLY to the landing page. It never imports, calls, or
// even knows about network.js, Socket.IO, or any multiplayer logic — it
// just handles a simple scroll-reveal effect for this page's sections.

document.addEventListener('DOMContentLoaded', () => {
  const revealEls = document.querySelectorAll('.reveal');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // If the person prefers reduced motion, or this browser has no
  // IntersectionObserver support, just show everything immediately.
  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target); // reveal once; don't re-trigger on scroll-up
      }
    });
  }, { threshold: 0.15 });

  revealEls.forEach((el) => observer.observe(el));
});
