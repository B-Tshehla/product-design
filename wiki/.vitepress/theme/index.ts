import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import { onMounted, watch, nextTick } from 'vue';
import { useRoute } from 'vitepress';
import mediumZoom from 'medium-zoom';
import Icon from './Icon.vue';
import './custom.css';
import 'virtual:group-icons.css';

// SVG icon strings for zoom controls (inline, no emoji)
const ICON = {
  zoomIn: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  zoomOut: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  reset: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
  close: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  focus: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  expand: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-6-6m6 6v-4.8m0 4.8h-4.8"/><path d="M3 16.2V21m0 0h4.8M3 21l6-6"/><path d="M21 7.8V3m0 0h-4.8M21 3l-6 6"/><path d="M3 7.8V3m0 0h4.8M3 3l6 6"/></svg>',
};

export default {
  extends: DefaultTheme,

  enhanceApp({ app }: { app: any }) {
    app.component('Icon', Icon);
  },

  setup() {
    const route = useRoute();

    const initZoom = () => {
      mediumZoom('.main img:not(.no-zoom)', {
        background: 'rgba(13, 17, 23, 0.92)',
      });
    };

    const initMermaidZoom = () => {
      let attempts = 0;
      const maxAttempts = 20;

      const prefixSvgIds = (svgString: string): string => {
        const prefix = '_z' + Math.random().toString(36).substring(2, 8) + '_';
        const ids = new Set<string>();
        const idRegex = /\bid="([^"]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = idRegex.exec(svgString)) !== null) ids.add(m[1]);

        let result = svgString;
        for (const id of ids) {
          // Replace id declarations, url(#id), href="#id", xlink:href="#id"
          result = result.split(`id="${id}"`).join(`id="${prefix}${id}"`);
          result = result.split(`url(#${id})`).join(`url(#${prefix}${id})`);
          result = result.split(`href="#${id}"`).join(`href="#${prefix}${id}"`);
          // CSS selectors inside <style>: #id { ... }
          result = result.split(`#${id}{`).join(`#${prefix}${id}{`);
          result = result.split(`#${id} {`).join(`#${prefix}${id} {`);
          result = result.split(`#${id} `).join(`#${prefix}${id} `);
        }
        return result;
      };

      const tryAttach = () => {
        const containers = document.querySelectorAll('.mermaid:not([data-zoom-attached])');

        if (containers.length === 0 && attempts < maxAttempts) {
          attempts++;
          setTimeout(tryAttach, 500);
          return;
        }

        containers.forEach((container) => {
          container.setAttribute('data-zoom-attached', 'true');
          (container as HTMLElement).style.cursor = 'pointer';

          container.addEventListener('click', (e) => {
            // Don't trigger on hint click propagation
            if (window.getSelection()?.toString()) return;

            const svg = container.querySelector('svg');
            if (!svg) return;

            // Clone SVG as string and prefix all IDs to avoid conflicts
            const svgString = svg.outerHTML;
            const safeSvg = prefixSvgIds(svgString);

            const overlay = document.createElement('div');
            overlay.className = 'mermaid-zoom-overlay';

            const svgContainer = document.createElement('div');
            svgContainer.className = 'mermaid-zoom-svg-container';
            svgContainer.innerHTML = safeSvg;

            // Style the cloned SVG for zoomed view — use viewBox for natural size, constrain with max
            const zoomedSvg = svgContainer.querySelector('svg');
            if (zoomedSvg) {
              const viewBox = zoomedSvg.getAttribute('viewBox');
              if (viewBox) {
                const parts = viewBox.split(' ');
                zoomedSvg.setAttribute('width', parts[2]);
                zoomedSvg.setAttribute('height', parts[3]);
              }
              zoomedSvg.style.maxWidth = '92vw';
              zoomedSvg.style.maxHeight = '85vh';
            }

            let scale = 1;
            let translateX = 0;
            let translateY = 0;

            const applyTransform = () => {
              svgContainer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
            };

            const controls = document.createElement('div');
            controls.className = 'mermaid-zoom-controls';
            controls.innerHTML = `
              <button class="zoom-btn" data-action="zoom-in" title="Zoom In (+)">${ICON.zoomIn}</button>
              <button class="zoom-btn" data-action="zoom-out" title="Zoom Out (−)">${ICON.zoomOut}</button>
              <button class="zoom-btn" data-action="reset" title="Reset (0)">${ICON.reset}</button>
              <button class="zoom-btn" data-action="close" title="Close (Esc)">${ICON.close}</button>
            `;

            const cleanup = () => {
              overlay.remove();
              document.body.style.overflow = '';
              window.removeEventListener('keydown', handleKeydown);
              window.removeEventListener('mousemove', handleMouseMove);
              window.removeEventListener('mouseup', handleMouseUp);
            };

            controls.addEventListener('click', (e) => {
              const btn = (e.target as HTMLElement).closest('[data-action]');
              if (!btn) return;
              e.stopPropagation();
              const action = btn.getAttribute('data-action');
              if (action === 'zoom-in') {
                scale = Math.min(scale * 1.3, 5);
                applyTransform();
              } else if (action === 'zoom-out') {
                scale = Math.max(scale / 1.3, 0.2);
                applyTransform();
              } else if (action === 'reset') {
                scale = 1;
                translateX = 0;
                translateY = 0;
                applyTransform();
              } else if (action === 'close') {
                cleanup();
              }
            });

            overlay.addEventListener('wheel', (e) => {
              e.preventDefault();
              if (e.deltaY < 0) {
                scale = Math.min(scale * 1.1, 5);
              } else {
                scale = Math.max(scale / 1.1, 0.2);
              }
              applyTransform();
            }, { passive: false });

            let isDragging = false;
            let startX = 0;
            let startY = 0;

            svgContainer.addEventListener('mousedown', (e) => {
              isDragging = true;
              startX = e.clientX - translateX;
              startY = e.clientY - translateY;
              svgContainer.style.cursor = 'grabbing';
              e.preventDefault();
            });

            const handleMouseMove = (e: MouseEvent) => {
              if (!isDragging) return;
              translateX = e.clientX - startX;
              translateY = e.clientY - startY;
              applyTransform();
            };

            const handleMouseUp = () => {
              isDragging = false;
              svgContainer.style.cursor = 'grab';
            };

            const handleKeydown = (e: KeyboardEvent) => {
              if (e.key === 'Escape') {
                cleanup();
              } else if (e.key === '+' || e.key === '=') {
                scale = Math.min(scale * 1.3, 5);
                applyTransform();
              } else if (e.key === '-') {
                scale = Math.max(scale / 1.3, 0.2);
                applyTransform();
              } else if (e.key === '0') {
                scale = 1;
                translateX = 0;
                translateY = 0;
                applyTransform();
              }
            };

            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            window.addEventListener('keydown', handleKeydown);

            overlay.addEventListener('click', (e) => {
              if (e.target === overlay) {
                cleanup();
              }
            });

            overlay.appendChild(svgContainer);
            overlay.appendChild(controls);
            document.body.appendChild(overlay);
            document.body.style.overflow = 'hidden';
          });
        });
      };

      tryAttach();
    };

    const initFocusMode = () => {
      if (document.querySelector('.focus-mode-toggle')) return;

      const btn = document.createElement('button');
      btn.className = 'focus-mode-toggle';
      btn.title = 'Toggle Focus Mode (F)';
      btn.innerHTML = ICON.focus;
      document.body.appendChild(btn);

      btn.addEventListener('click', () => {
        document.body.classList.toggle('focus-mode');
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'f' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
          document.body.classList.toggle('focus-mode');
        }
      });
    };

    onMounted(() => {
      initZoom();
      initMermaidZoom();
      initFocusMode();
    });

    watch(
      () => route.path,
      () =>
        nextTick(() => {
          initZoom();
          initMermaidZoom();
        }),
    );
  },
} satisfies Theme;
