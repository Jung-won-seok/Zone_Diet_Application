// A small software rasterizer keeps the 3D view available on the player'state
// existing 2D canvas. The depth buffer resolves intersections pixel by pixel.
const drawMovementPose3D = (() => {
  const motionEnvelopes = new WeakMap();
  const canvasBuffers = new WeakMap();
  const colorRamps = new Map();
  const distance = 530;
  const floorY = 202;

  function createMesh(type) {
    const vertices = [];
    const triangles = [];
    const vertex = (x, y, z, nx, ny, nz) => vertices.push([x, y, z, nx, ny, nz]) - 1;
    const quad = (a, b, c, d) => triangles.push(a, b, c, a, c, d);
    if (type === 'box') {
      for (let axis = 0; axis < 3; axis++) {
        for (const side of [-1, 1]) {
          const normal = [0, 0, 0];
          normal[axis] = side;
          const ids = [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].map(([u, v]) => {
            const p = normal.slice();
            p[(axis + 1) % 3] = u;
            p[(axis + 2) % 3] = v;
            return vertex(...p, ...normal);
          });
          quad(...ids);
        }
      }
    } else {
      const sphere = type === 'ellipsoid';
      const rings = sphere ? 9 : 1;
      const slices = 16;
      for (let i = 0; i <= rings; i++) {
        const latitude = Math.PI * (i / rings - 0.5);
        const z = sphere ? Math.sin(latitude) : 2 * i - 1;
        const radius = sphere ? Math.cos(latitude) : 1;
        for (let j = 0; j < slices; j++) {
          const angle = (j * Math.PI * 2) / slices;
          const x = radius * Math.cos(angle);
          const y = radius * Math.sin(angle);
          vertex(x, y, z, x, y, sphere ? z : 0);
          if (i) {
            const a = (i - 1) * slices + j;
            const b = (i - 1) * slices + ((j + 1) % slices);
            quad(a, b, b + slices, a + slices);
          }
        }
      }
      if (!sphere) {
        for (const z of [-1, 1]) {
          const center = vertex(0, 0, z, 0, 0, z);
          for (let j = 0; j < slices; j++) {
            const angle = (j * Math.PI * 2) / slices;
            vertex(Math.cos(angle), Math.sin(angle), z, 0, 0, z);
            triangles.push(center, center + 1 + j, center + 1 + ((j + 1) % slices));
          }
        }
      }
    }
    return { vertices, triangles };
  }
  const meshes = Object.fromEntries(['ellipsoid', 'tube', 'box'].map((type) => [type, createMesh(type)]));
  const projectedBufferLength = Math.max(...Object.values(meshes).map((mesh) => mesh.vertices.length)) * 4;

  const packColor = (r, g, b) =>
    (255 << 24) | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r);
  function colorRamp(color) {
    if (!colorRamps.has(color)) {
      const value = parseInt(color.slice(1), 16);
      const r = value >> 16;
      const g = (value >> 8) & 255;
      const b = value & 255;
      colorRamps.set(
        color,
        Uint32Array.from({ length: 128 }, (_, i) => {
          const light = 0.68 + (0.43 * i) / 127;
          const glint = 6 * (i / 127) ** 6;
          return packColor(r * light + glint, g * light + glint, b * light + glint);
        })
      );
    }
    return colorRamps.get(color);
  }

  // Use the whole repetition'state envelope so seeking and playback never recenter
  // the camera. Equipment, a thrown ball and feet in flight all contribute.
  function getEnvelope(motion) {
    if (motionEnvelopes.has(motion)) return motionEnvelopes.get(motion);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, floorY, -Infinity];
    for (const frame of motion.frames) {
      for (const part of buildMovementScene3D(motion, frame.pose, [])) {
        for (let i = 0; i < 3; i++) {
          if (part.type === 'tube') {
            const r = Math.max(part.r1, part.r2);
            min[i] = Math.min(min[i], part.a[i] - r, part.b[i] - r);
            max[i] = Math.max(max[i], part.a[i] + r, part.b[i] + r);
          } else {
            const components = part.axes.map((v) => v[i]);
            const radius =
              part.type === 'box'
                ? components.reduce((a, b) => a + Math.abs(b), 0)
                : Math.hypot(...components);
            min[i] = Math.min(min[i], part.center[i] - radius);
            max[i] = Math.max(max[i], part.center[i] + radius);
          }
        }
      }
    }
    const target = min.map((v, i) => (v + max[i]) / 2);
    const frame = { target, half: min.map((v, i) => target[i] - v) };
    motionEnvelopes.set(motion, frame);
    return frame;
  }

  function createCamera(envelope, width, height, yaw, pitch) {
    // Keep the camera above the floor, including when a push-up is seen from low down.
    pitch = Math.max(pitch, Math.asin((envelope.target[1] - floorY + 4) / distance));
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const sp = Math.sin(pitch);
    const cp = Math.cos(pitch);
    const toCameraVector = ([x, y, z]) => [
      x * cy - z * sy,
      (x * sy + z * cy) * sp + y * cp,
      -(x * sy + z * cy) * cp + y * sp,
    ];
    let focal = ((distance * height) / 220) * 1.65;
    for (const xSign of [-1, 1]) {
      for (const ySign of [-1, 1]) {
        for (const zSign of [-1, 1]) {
          const [x, y, z] = toCameraVector([
            xSign * envelope.half[0],
            ySign * envelope.half[1],
            zSign * envelope.half[2],
          ]);
          focal = Math.min(
            focal,
            (width * 0.45 * (distance + z)) / (Math.abs(x) || 1),
            (height * 0.445 * (distance + z)) / (Math.abs(y) || 1)
          );
        }
      }
    }
    const [tx, ty, tz] = envelope.target;
    return {
      toCameraVector,
      focal,
      sy,
      cy,
      sp,
      cp,
      width,
      height,
      target: envelope.target,
      eye: [tx + distance * sy * cp, ty - distance * sp, tz + distance * cy * cp],
      toCameraPoint: ([x, y, z]) => {
        const v = toCameraVector([x - tx, y - ty, z - tz]);
        v[2] += distance;
        return v;
      },
    };
  }

  // A ray hits the horizontal floor at the same camera depth throughout a
  // scanline. Cache the grid and its depth until the viewpoint changes.
  function makeStage(state, camera) {
    const { width, height, focal, eye, sp, cp, sy, cy } = camera;
    for (let y = 0; y < height; y++) {
      const ny = (y + 0.5 - height / 2) / focal;
      const row = y * width;
      const inverseDepth = Math.max(0, (sp + ny * cp) / (floorY + 0.08 - eye[1]));
      state.floorDepth[y] = inverseDepth;
      const fade = y / height;
      const red = 244 - 16 * fade;
      const green = 248 - 11 * fade;
      const blue = 240 - 15 * fade;
      if (inverseDepth < 1 / 1400) {
        state.background.fill(packColor(red, green, blue), row, row + width);
        continue;
      }
      const depth = 1 / inverseDepth;
      const worldPerPixel = depth / focal;
      const forward = -cp + ny * sp;
      const floorTint = Math.min(1, (inverseDepth - 1 / 1400) * 550);
      const depthStep = (worldPerPixel * depth * cp) / (floorY + 0.08 - eye[1]);
      const lineX = 0.48 + Math.abs(worldPerPixel * cy) + Math.abs(depthStep * sy);
      const lineZ = 0.48 + Math.abs(worldPerPixel * sy) + Math.abs(depthStep * cy);
      let x = eye[0] + depth * sy * forward + (0.5 - width / 2) * worldPerPixel * cy;
      let z = eye[2] + depth * cy * forward - (0.5 - width / 2) * worldPerPixel * sy;
      for (let i = 0; i < width; i++, x += worldPerPixel * cy, z -= worldPerPixel * sy) {
        const localX = x - camera.target[0];
        const localZ = z - camera.target[2];
        const visible = Math.max(0, 1 - (localX * localX + localZ * localZ) / 34000);
        const gridDistanceX = Math.abs(localX - Math.round(localX / 26) * 26);
        const gridDistanceZ = Math.abs(localZ - Math.round(localZ / 26) * 26);
        const gridX = Math.max(0, 1 - gridDistanceX / lineX) / Math.max(1, lineX);
        const gridZ = Math.max(0, 1 - gridDistanceZ / lineZ) / Math.max(1, lineZ);
        const grid = visible * Math.max(gridX, gridZ);
        state.background[row + i] = packColor(
          red - 5 * floorTint - grid * 25,
          green - 3 * floorTint - grid * 23,
          blue - 5 * floorTint - grid * 21
        );
      }
    }
  }

  function paintFloorShadow(state, camera, pose) {
    const xs = [pose.hip[0], pose.shoulder[0], pose.ankle[0], pose.toe[0]];
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const x = (min + max) / 2;
    const radiusX = 19 + (max - min) * 0.52;
    const radiusZ = 18;
    const { width, height, focal, sy, cy, sp, cp, eye } = camera;
    const corners = [
      [-radiusX, -radiusZ],
      [radiusX, -radiusZ],
      [radiusX, radiusZ],
      [-radiusX, radiusZ],
    ].map(([dx, dz]) => {
      const point = camera.toCameraPoint([x + dx, floorY, dz]);
      return [width / 2 + (focal * point[0]) / point[2], height / 2 + (focal * point[1]) / point[2]];
    });
    const left = Math.max(0, Math.floor(Math.min(...corners.map((v) => v[0]))));
    const right = Math.min(width - 1, Math.ceil(Math.max(...corners.map((v) => v[0]))));
    const top = Math.max(0, Math.floor(Math.min(...corners.map((v) => v[1]))));
    const bottom = Math.min(height - 1, Math.ceil(Math.max(...corners.map((v) => v[1]))));
    const strength = 0.18 / (1 + Math.max(0, floorY - pose.toe[1]) * 0.012);
    for (let pixelY = top; pixelY <= bottom; pixelY++) {
      if (!state.floorDepth[pixelY]) continue;
      const depth = 1 / state.floorDepth[pixelY];
      const worldPerPixel = depth / focal;
      const ny = (pixelY + 0.5 - height / 2) / focal;
      let dx = eye[0] + depth * sy * (-cp + ny * sp) + (left + 0.5 - width / 2) * worldPerPixel * cy - x;
      let dz = eye[2] + depth * cy * (-cp + ny * sp) - (left + 0.5 - width / 2) * worldPerPixel * sy;
      for (
        let pixelX = left;
        pixelX <= right;
        pixelX++, dx += worldPerPixel * cy, dz -= worldPerPixel * sy
      ) {
        const alpha = 1 - (dx * dx) / (radiusX * radiusX) - (dz * dz) / (radiusZ * radiusZ);
        if (alpha <= 0) continue;
        const multiplier = 1 - strength * alpha * alpha;
        const i = pixelY * width + pixelX;
        const backgroundColor = state.pixels[i];
        state.pixels[i] = packColor(
          (backgroundColor & 255) * multiplier,
          ((backgroundColor >> 8) & 255) * multiplier,
          ((backgroundColor >> 16) & 255) * multiplier
        );
      }
    }
  }

  function rasterizeTriangle(state, vertices, aOffset, bOffset, cOffset, palette) {
    const ax = vertices[aOffset];
    const ay = vertices[aOffset + 1];
    const bx = vertices[bOffset];
    const by = vertices[bOffset + 1];
    const cx = vertices[cOffset];
    const cy = vertices[cOffset + 1];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 0.005) return;
    const left = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5));
    const right = Math.min(state.width - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
    const top = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5));
    const bottom = Math.min(state.height - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
    // Barycentric weights for the pixel center. Inverse view depth is linear
    // in these screen-space coordinates; larger values are nearer the camera.
    const duDx = (cy - ay) / area;
    const duDy = (ax - cx) / area;
    const dvDx = (ay - by) / area;
    const dvDy = (bx - ax) / area;
    const depthA = vertices[aOffset + 2];
    const depthBDelta = vertices[bOffset + 2] - depthA;
    const depthCDelta = vertices[cOffset + 2] - depthA;
    const lightA = vertices[aOffset + 3];
    const lightBDelta = vertices[bOffset + 3] - lightA;
    const lightCDelta = vertices[cOffset + 3] - lightA;
    for (let y = top; y <= bottom; y++) {
      let u = (left + 0.5 - ax) * duDx + (y + 0.5 - ay) * duDy;
      let v = (left + 0.5 - ax) * dvDx + (y + 0.5 - ay) * dvDy;
      for (let x = left, i = y * state.width + left; x <= right; x++, i++, u += duDx, v += dvDx) {
        if (u < 0 || v < 0 || u + v > 1) continue;
        const inverseDepth = depthA + u * depthBDelta + v * depthCDelta;
        if (inverseDepth <= state.depth[i]) continue;
        state.depth[i] = inverseDepth;
        state.pixels[i] = palette[(lightA + u * lightBDelta + v * lightCDelta) | 0];
      }
    }
  }

  function paintPart(state, camera, part) {
    const mesh = meshes[part.type];
    const tube = part.type === 'tube';
    let center;
    let axes;
    let taper = 0;
    if (tube) {
      center = part.a.map((n, i) => (n + part.b[i]) / 2);
      const axis = part.b.map((n, i) => (n - part.a[i]) / 2);
      const length = Math.hypot(...axis);
      if (length < 0.0001) return;
      const [x, y, z] = axis.map((n) => n / length);
      const radialLength = Math.hypot(x, y);
      const axisX = radialLength > 0.0001 ? [y / radialLength, -x / radialLength, 0] : [1, 0, 0];
      axes = [
        axisX,
        [y * axisX[2] - z * axisX[1], z * axisX[0] - x * axisX[2], x * axisX[1] - y * axisX[0]],
        axis,
      ];
      taper = (part.r1 - part.r2) / 2;
    } else {
      center = part.center;
      axes = part.axes;
    }
    const origin = camera.toCameraPoint(center);
    const [axisX, axisY, axisZ] = axes.map(camera.toCameraVector);
    // Transform normals with the inverse transpose of the three orthogonal axes.
    const inverseSquaredLengths = [axisX, axisY, axisZ].map(
      (axis) => 1 / (axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2)
    );
    const projectedVertices = state.projectedVertices;
    for (let i = 0; i < mesh.vertices.length; i++) {
      let [x, y, z, nx, ny, nz] = mesh.vertices[i];
      if (tube) {
        const radius = z < 0 ? part.r1 : part.r2;
        x *= radius;
        y *= radius;
        if (nz === 0) nz = taper;
      }
      const depth = origin[2] + axisX[2] * x + axisY[2] * y + axisZ[2] * z;
      const inverseDepth = 1 / depth;
      const offset = i * 4;
      projectedVertices[offset] =
        state.width / 2 +
        camera.focal * (origin[0] + axisX[0] * x + axisY[0] * y + axisZ[0] * z) * inverseDepth;
      projectedVertices[offset + 1] =
        state.height / 2 +
        camera.focal * (origin[1] + axisX[1] * x + axisY[1] * y + axisZ[1] * z) * inverseDepth;
      projectedVertices[offset + 2] = inverseDepth;
      nx *= inverseSquaredLengths[0];
      ny *= inverseSquaredLengths[1];
      nz *= inverseSquaredLengths[2];
      const normalX = axisX[0] * nx + axisY[0] * ny + axisZ[0] * nz;
      const normalY = axisX[1] * nx + axisY[1] * ny + axisZ[1] * nz;
      const normalZ = axisX[2] * nx + axisY[2] * ny + axisZ[2] * nz;
      const inverseMagnitude = 1 / Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);
      const diffuse = (-0.41 * normalX - 0.65 * normalY - 0.64 * normalZ) * inverseMagnitude;
      projectedVertices[offset + 3] = Math.min(127, Math.max(0, 0.2 + 0.8 * diffuse) * 127);
    }
    const indices = mesh.triangles;
    const palette = colorRamp(part.color);
    for (let i = 0; i < indices.length; i += 3)
      rasterizeTriangle(
        state,
        projectedVertices,
        indices[i] * 4,
        indices[i + 1] * 4,
        indices[i + 2] * 4,
        palette
      );
  }

  return function draw(canvas, motion, pose, regions = [], view = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const width = Math.max(
      1,
      Math.min(
        720,
        Math.round((canvas.clientWidth || 320) * Math.max(1.4, Math.min(2, window.devicePixelRatio || 1)))
      )
    );
    const height = Math.max(1, Math.round((width * 220) / 320));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    let state = canvasBuffers.get(canvas);
    if (!state || state.width !== width || state.height !== height) {
      const image = ctx.createImageData(width, height);
      state = {
        width,
        height,
        image,
        pixels: new Uint32Array(image.data.buffer),
        background: new Uint32Array(width * height),
        depth: new Float32Array(width * height),
        floorDepth: new Float32Array(height),
        projectedVertices: new Float64Array(projectedBufferLength),
      };
      canvasBuffers.set(canvas, state);
    }
    const yaw = view.yaw ?? 0.48;
    const pitch = view.pitch ?? 0.09;
    if (state.motion !== motion || state.yaw !== yaw || state.pitch !== pitch) {
      state.motion = motion;
      state.yaw = yaw;
      state.pitch = pitch;
      state.camera = createCamera(getEnvelope(motion), width, height, yaw, pitch);
      makeStage(state, state.camera);
    }
    state.pixels.set(state.background);
    for (let y = 0; y < height; y++) state.depth.fill(state.floorDepth[y], y * width, (y + 1) * width);
    paintFloorShadow(state, state.camera, pose);
    for (const part of buildMovementScene3D(motion, pose, regions)) paintPart(state, state.camera, part);
    ctx.putImageData(state.image, 0, 0);
    return true;
  };
})();
