/**
 * Geometry for a map whose physical transition canvas may be larger than its
 * historical / player-navigable painted region. All coordinates are in source
 * image pixels until the returned layout converts them to CSS pixels.
 * Keeps the regular one-image chapter maps backward compatible.
 */
export const clampMap = (value, min, max) => Math.min(max, Math.max(min,value));

export function mapContentRect(width,height,bounds) {
  const box=bounds ?? {x:0,y:0,width,height};
  const valid=[width,height,box.x,box.y,box.width,box.height]
    .every(Number.isFinite) && width>0 && height>0 &&
    box.x>=0 && box.y>=0 && box.width>0 && box.height>0 &&
    box.x+box.width<=width && box.y+box.height<=height;
  if (!valid) throw new RangeError('地图可探索范围必须位于画布内');
  return box;
}

export function mapMarkerPercent(marker,width,height,bounds) {
  const box=mapContentRect(width,height,bounds);
  return {
    x: (box.x + clampMap(marker.x,0,1)*box.width)/width*100,
    y: (box.y + clampMap(marker.y,0,1)*box.height)/height*100,
  };
}

export function mapCameraLayout({width,height,viewportWidth,viewportHeight,
  contentBounds=null,overscan=1.22}) {
  const box=mapContentRect(width,height,contentBounds);
  if (!(viewportWidth>0 && viewportHeight>0 && overscan>=1)) {
    throw new RangeError('地图视口大小或缩放比例不合法');
  }
  // Scale by the ORIGINAL painted region, not by its offscreen buffer.
  // This preserves the V10.1 viewing scale after expanding the image canvas.
  const scale=Math.max(viewportWidth/box.width,viewportHeight/box.height)*overscan;
  const coreLeft=box.x*scale,coreTop=box.y*scale;
  const coreWidth=box.width*scale,coreHeight=box.height*scale;
  const sceneWidth=width*scale,sceneHeight=height*scale;
  return {
    scale,sceneWidth,sceneHeight,coreLeft,coreTop,coreWidth,coreHeight,
    viewportWidth,viewportHeight,
    // Pan is bounded by the user's original painted image. The exterior
    // is never included in the draggable range, not even for keyboard pan.
    minX: viewportWidth-coreLeft-coreWidth,
    maxX: -coreLeft,
    minY: viewportHeight-coreTop-coreHeight,
    maxY: -coreTop,
  };
}
