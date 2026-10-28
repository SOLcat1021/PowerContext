import * as THREE from 'three';

// Project 3D guides into a crisp CSS-resolution vector layer. Keep stars and glows on the GPU.
export function createVectorScene(svg, camera) {
  let guides = [], links = [], dirty = true;
  let guideElements = [], linkElements = [];
  const matrix = new THREE.Matrix4();
  const projection = new THREE.Matrix4();
  const screenPoints = [];
  const viewProjection = new THREE.Matrix4(), frustum = new THREE.Frustum();
  const start = new THREE.Vector3(), end = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const project = (point, width, height) => {
    point.applyMatrix4(camera.projectionMatrix);
    point.x = (point.x * .5 + .5) * width;
    point.y = (-point.y * .5 + .5) * height;
    return point;
  };
  const position = (point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;

  function segmentPath(width, height) {
    // Clip in camera space before perspective division, including lines crossing the near plane.
    const near = -camera.near, far = -camera.far;
    const dz = end.z - start.z;
    let t0 = 0, t1 = 1;
    if (Math.abs(dz) < 1e-10) {
      if (start.z > near || start.z < far) return '';
    } else {
      const first = (far - start.z) / dz, last = (near - start.z) / dz;
      t0 = Math.max(0, Math.min(first, last)); t1 = Math.min(1, Math.max(first, last));
      if (t0 > t1) return '';
    }
    a.copy(start).lerp(end, t0); b.copy(start).lerp(end, t1);
    return `M${position(project(a, width, height))}L${position(project(b, width, height))}`;
  }

  function clippedPathFor(object, width, height) {
    const points = object.geometry.getAttribute('position');
    matrix.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld);
    let path = '', previousEnd = '';
    const step = object.isLineSegments ? 2 : 1;
    const count = object.isLineLoop ? points.count : points.count - 1;
    for (let i = 0; i < count; i += step) {
      start.fromBufferAttribute(points, i).applyMatrix4(matrix);
      end.fromBufferAttribute(points, (i + 1) % points.count).applyMatrix4(matrix);
      const segment = segmentPath(width, height);
      if (!segment) { previousEnd = ''; continue; }
      const separator = segment.indexOf('L');
      const currentStart = segment.slice(1, separator);
      path += !object.isLineSegments && currentStart === previousEnd ? segment.slice(separator) : segment;
      previousEnd = segment.slice(separator + 1);
    }
    return path;
  }

  function pathFor(object, width, height) {
    const points = object.geometry.getAttribute('position');
    projection.multiplyMatrices(viewProjection, object.matrixWorld);
    const m = projection.elements;
    // Ordinary circles are wholly in front of the camera. Project each vertex once;
    // avoid two matrix transforms per segment and reparsing the generated SVG text.
    for (let i = 0; i < points.count; i++) {
      const x = points.getX(i), y = points.getY(i), z = points.getZ(i);
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      const depth = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (w <= 0 || depth < -w || depth > w) return clippedPathFor(object, width, height);
      const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * .5 + .5) * width;
      const sy = (-(m[1] * x + m[5] * y + m[9] * z + m[13]) / w * .5 + .5) * height;
      screenPoints[i] = `${sx.toFixed(2)} ${sy.toFixed(2)}`;
    }
    let path = '';
    for (let i = 0; i < points.count; i++) path += `${i === 0 || (object.isLineSegments && i % 2 === 0) ? 'M' : 'L'}${screenPoints[i]}`;
    if (object.isLineLoop && points.count) path += `L${screenPoints[0]}`;
    return path;
  }

  return {
    setObjects(nextGuides, nextLinks) {
      guides = nextGuides; links = nextLinks; dirty = true;
    },
    update(width, height) {
      if (dirty) {
        svg.innerHTML = guides.map((object) => `<path class="vector-guide" stroke="#${object.material.color.getHexString()}"${object.material.isLineDashedMaterial ? ' stroke-dasharray="2.3 4.1"' : ''}/>`).join('')
          + links.map(() => '<g class="vector-relation"><path/><polygon/></g>').join('');
        guideElements = [...svg.querySelectorAll('.vector-guide')];
        linkElements = [...svg.querySelectorAll('.vector-relation')].map((el) => ({ path: el.querySelector('path'), arrow: el.querySelector('polygon') }));
        dirty = false;
      }
      const viewBox = `0 0 ${width} ${height}`;
      if (svg.getAttribute('viewBox') !== viewBox) svg.setAttribute('viewBox', viewBox);
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
      guides.forEach((object, index) => {
        const el = guideElements[index];
        el.setAttribute('d', frustum.intersectsObject(object) ? pathFor(object, width, height) : '');
        el.setAttribute('opacity', object.material.opacity);
      });
      links.forEach((link, index) => {
        const { path, arrow } = linkElements[index];
        const material = link.line.material;
        if (!frustum.intersectsObject(link.line)) { path.setAttribute('d', ''); arrow.style.display = 'none'; return; }
        path.setAttribute('d', pathFor(link.line, width, height));
        path.setAttribute('stroke', `#${material.color.getHexString()}`);
        path.setAttribute('opacity', material.opacity);
        path.style.strokeWidth = material.opacity === 1 ? '1.8' : '1.1';
        arrow.style.display = link.arrow?.visible ? '' : 'none';
        if (!link.arrow?.visible) return;
        matrix.multiplyMatrices(camera.matrixWorldInverse, link.line.matrixWorld);
        const points = link.line.geometry.getAttribute('position');
        start.fromBufferAttribute(points, 0).applyMatrix4(matrix);
        end.fromBufferAttribute(points, 1).applyMatrix4(matrix);
        a.copy(link.arrow.position).applyMatrix4(matrix);
        if (start.z >= -camera.near || end.z >= -camera.near || a.z < -camera.far) { arrow.style.display = 'none'; return; }
        const from = project(start, width, height), to = project(end, width, height), center = project(a, width, height);
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        if (length < 1) { arrow.style.display = 'none'; return; }
        const dx = (to.x - from.x) / length, dy = (to.y - from.y) / length;
        const size = Math.min(7, length * .18);
        arrow.setAttribute('points', `${center.x + dx * size * .5},${center.y + dy * size * .5} ${center.x - dx * size * .5 - dy * size * .45},${center.y - dy * size * .5 + dx * size * .45} ${center.x - dx * size * .5 + dy * size * .45},${center.y - dy * size * .5 - dx * size * .45}`);
        arrow.setAttribute('fill', `#${link.arrow.material.color.getHexString()}`);
        arrow.setAttribute('opacity', link.arrow.material.opacity);
      });
    },
  };
}
