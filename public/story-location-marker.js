/**
 * Current-story locator is a child of the *real map marker's dot*, not a free
 * floating image calculated from world-image coordinates. The marker camera
 * owns positioning, zoom and panning for both the dot and its ornament.
 */
export const STORY_LOCATOR_URL = '/assets/ui/locator-turquoise-mask-v79.png';

export function mountActiveStoryLocators(host, markers, iconUrl=STORY_LOCATOR_URL) {
  if (!host || !Array.isArray(markers)) return 0;
  const buttons = Array.from(host.querySelectorAll('.map-camera-scene .scene-gate'));
  let attached = 0;
  for (const marker of markers) {
    if (!marker.currentLocator) continue;
    const button = buttons.find(node => node.dataset?.markerId === marker.id ||
      node.getAttribute?.('data-marker-id') === marker.id);
    const dot = button?.querySelector?.('.scene-gate__dot');
    if (!dot || dot.querySelector('.story-location-ornament')) continue;
    const img = document.createElement('img');
    img.className = 'story-location-ornament';
    img.src = iconUrl;
    img.alt = '';
    img.draggable = false;
    img.setAttribute('aria-hidden','true');
    // Deliberately inline: no dependency on an old reused style ID or on the
    // base stylesheet version. All positioning remains local to the dot.
    Object.assign(img.style, {
      position:'absolute',display:'block',maxWidth:'none',
      left:'50%',top:'-72px',width:'66px',height:'72px',
      transform:'translateX(-50%)',objectFit:'contain',
      pointerEvents:'none',userSelect:'none',zIndex:'3',
      filter:'drop-shadow(0 2px 4px rgba(31,22,14,.75))',
    });
    dot.append(img);
    button.classList.add('has-story-location-ornament');
    attached += 1;
  }
  return attached;
}
