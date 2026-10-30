/** Build the main interactive training cockpit. Flight dynamics are intentionally game-like. */
export function initializeSimulator(container, { onExit = () => {}, onInstrumentSelect = () => {}, onLandingMissionStart = () => true, onLandingProgress = () => {}, onLandingResult = () => {} } = {}) {
  if (!container) return null;
  const canvasHost = container.querySelector('#simulator-canvas');
  const root = container;
  const status = root.querySelector('#sim-state');
  let loading = root.querySelector('#sim-loading');
  if (!loading) {
    loading = document.createElement('div');
    loading.id = 'sim-loading';
    loading.className = 'sim-loading';
    loading.innerHTML = '<span class="sim-spinner"></span><b>Загружаем 3D-кабину…</b><small>Подготавливаем приборы и сцену</small>';
    canvasHost.prepend(loading);
  }
  const pauseOverlay = root.querySelector('#sim-pause-overlay');
  const instruments = [
    { id: 'airspeed', title: 'Указатель воздушной скорости', purpose: 'Показывает скорость самолёта относительно окружающего воздуха.', example: 'Скорость постепенно меняется вслед за тягой двигателя и аэродинамическим сопротивлением.', get: (f) => `${Math.round(f.speed)} kt` },
    { id: 'attitude', title: 'Авиагоризонт', purpose: 'Показывает положение самолёта относительно линии горизонта: тангаж и крен.', example: 'Нажми W или S, затем A или D: символ самолёта и горизонт покажут изменение положения.', get: (f) => `Тангаж ${Math.round(f.pitch)}° · крен ${Math.round(f.bank)}°` },
    { id: 'altimeter', title: 'Высотомер', purpose: 'Показывает высоту самолёта над выбранным уровнем отсчёта.', example: 'При наборе или снижении высота постепенно меняется вместе с вертикальной скоростью.', get: (f) => `${Math.round(f.altitude)} ft` },
    { id: 'vertical-speed', title: 'Индикатор вертикальной скорости', purpose: 'Показывает темп набора высоты или снижения.', example: 'Показание зависит от воздушной скорости и угла траектории, заданного тангажом.', get: (f) => `${f.verticalSpeed > 0 ? '+' : ''}${Math.round(f.verticalSpeed)} ft/min` },
    { id: 'compass', title: 'Компас', purpose: 'Показывает направление, в котором ориентирован самолёт.', example: 'Удерживай крен влево или вправо: курс будет меняться плавно, пока самолёт наклонён.', get: (f) => `${String(Math.round(f.heading + 360) % 360).padStart(3, '0')}°` },
    { id: 'rpm', title: 'Индикатор оборотов двигателя', purpose: 'Показывает частоту вращения двигателя.', example: 'Обороты изменяются вместе с установленной тягой.', get: (f) => `${Math.round(f.rpm)} RPM` },
    { id: 'controls', title: 'Штурвал и педали', purpose: 'Штурвал задаёт команды по тангажу и крену; педали связаны с управлением рысканием.', example: 'Используй W/S и A/D: штурвал в кабине отклоняется вслед за командами. Экранные стрелки доступны на телефоне.', get: (f) => `Тангаж ${Math.round(f.pitch)}° · крен ${Math.round(f.bank)}°` },
  ];
  let disposed = false;
  let active = true;
  let paused = false;
  let pendingLandingStart = null;
  let renderer, scene, camera, resizeObserver, animationId, animationRunning = false, lastFrame = 0;
  let cameraYaw = 0, cameraPitch = 0.03, cameraDistance = 4.1;
  let dragPointer = null;
  let retryHandler = null;
  let hovered = null;
  const held = new Set();
  const meshes = new Map();
  const flight = { pitch: 0, bank: 0, heading: 0, altitude: 2500, speed: 95, verticalSpeed: 0, rpm: 2200, throttle: 0.4, flaps: 0, gearDown: true, brakes: false, trim: 0, spoilers: false, onGround: false };
  const defaultFlight = { ...flight };
  const feetToWorld = 0.03048;
  const runway = { centerX: 0, nearZ: -300, farZ: -480, width: 5, length: 180 };
  const landingMission = { active: false, stage: 0, stableSeconds: 0, resultSent: false, touchdown: null };
  let yoke;
  let horizonGroup;
  let cameraTarget;
  let gaugeNeedles = new Map();

  const setState = (label, kind = '') => { status.textContent = label; status.dataset.state = kind; };
  const setPaused = (value) => {
    paused = Boolean(value);
    pauseOverlay.classList.toggle('hidden', !paused);
    const button = root.querySelector('[data-sim-action="pause"]');
    button.textContent = paused ? 'Продолжить' : 'Пауза';
    setState(paused ? 'ПАУЗА' : active ? 'В ПОЛЁТЕ' : 'ПРИОСТАНОВЛЕН', paused ? 'paused' : 'ready');
    held.clear();
  };
  const setInfo = (instrument, notify = false) => {
    if (!instrument) return;
    root.querySelector('#sim-info-title').textContent = instrument.title;
    root.querySelector('#sim-info-purpose').textContent = instrument.purpose;
    root.querySelector('#sim-info-reading').textContent = instrument.get(flight);
    root.querySelector('#sim-info-example').textContent = instrument.example;
    if (notify) onInstrumentSelect({ ...instrument, reading: instrument.get(flight) });
  };
  const setFlaps = (value) => {
    flight.flaps = Math.max(0, Math.min(30, Number(value)));
    root.querySelectorAll('[data-flaps]').forEach((button) => button.classList.toggle('selected', Number(button.dataset.flaps) === flight.flaps));
    root.querySelector('#sim-flaps-value').textContent = `${flight.flaps}°`;
  };
  const setGear = (value) => {
    flight.gearDown = Boolean(value);
    const button = root.querySelector('[data-gear-toggle]');
    button.setAttribute('aria-pressed', String(flight.gearDown));
    button.classList.toggle('selected', flight.gearDown);
    button.textContent = flight.gearDown ? 'Выпущено' : 'Убрано';
    root.querySelector('#sim-gear-value').textContent = flight.gearDown ? 'DOWN' : 'UP';
  };
  const setBrakes = (value) => {
    flight.brakes = Boolean(value) && flight.onGround;
    const button = root.querySelector('[data-brakes-toggle]');
    button.disabled = !flight.onGround;
    button.setAttribute('aria-pressed', String(flight.brakes));
    button.classList.toggle('selected', flight.brakes);
    button.textContent = flight.brakes ? 'Нажаты' : 'Не нажаты';
  };
  const setSpoilers = (value) => {
    flight.spoilers = Boolean(value) && flight.onGround;
    const button = root.querySelector('[data-spoilers-toggle]');
    button.disabled = !flight.onGround;
    button.setAttribute('aria-pressed', String(flight.spoilers));
    button.classList.toggle('selected', flight.spoilers);
    button.textContent = flight.spoilers ? 'Выпущены' : 'Убраны';
  };
  const setTrim = (value) => {
    flight.trim = Math.max(-10, Math.min(10, Number(value)));
    root.querySelector('#sim-trim-value').textContent = `${flight.trim > 0 ? '+' : ''}${flight.trim}%`;
  };
  const setThrottle = (value) => {
    flight.throttle = Math.max(0, Math.min(1, Number(value) / 100));
    root.querySelector('#sim-throttle-control').value = Math.round(flight.throttle * 100);
    root.querySelector('#sim-throttle-control-value').textContent = `${Math.round(flight.throttle * 100)}%`;
  };
  const updateCamera = (THREE) => {
    cameraTarget ||= new THREE.Vector3(0, 0.82, -2.05);
    const target = cameraTarget;
    const cp = Math.cos(cameraPitch);
    camera.position.set(target.x + cameraDistance * Math.sin(cameraYaw) * cp, target.y + cameraDistance * Math.sin(cameraPitch), target.z + cameraDistance * Math.cos(cameraYaw) * cp);
    camera.lookAt(target);
  };
  const makeMaterial = (THREE, color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.12, ...options });
  const box = (THREE, parent, size, position, material, rotation = null) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    parent.add(mesh);
    return mesh;
  };
  const createGaugeTexture = (THREE, item) => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#172536'; ctx.beginPath(); ctx.arc(256, 256, 249, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c6d7e5'; ctx.lineWidth = 8;
    for (let i = 0; i <= 10; i++) { const a = (-Math.PI * 0.78) + (i / 10) * Math.PI * 1.56; ctx.beginPath(); ctx.moveTo(256 + Math.cos(a) * 184, 256 + Math.sin(a) * 184); ctx.lineTo(256 + Math.cos(a) * 218, 256 + Math.sin(a) * 218); ctx.stroke(); }
    ctx.fillStyle = '#e9f5ff'; ctx.textAlign = 'center'; ctx.font = '700 49px Arial'; ctx.fillText(item.id === 'airspeed' ? 'ASI' : item.id === 'attitude' ? 'AI' : item.id === 'altimeter' ? 'ALT' : item.id === 'vertical-speed' ? 'VSI' : item.id === 'compass' ? 'HDG' : item.id === 'rpm' ? 'RPM' : 'YOKE', 256, 275);
    ctx.fillStyle = '#79cdec'; ctx.font = '600 27px Arial'; ctx.fillText(item.id === 'airspeed' ? 'KNOTS' : item.id === 'altimeter' ? 'ALTITUDE' : item.id === 'vertical-speed' ? 'FT/MIN' : item.id === 'compass' ? 'HEADING' : item.id === 'rpm' ? 'ENGINE' : item.id === 'controls' ? 'CONTROL' : 'ATTITUDE', 256, 326);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
  };
  const buildScene = (THREE) => {
    scene = new THREE.Scene(); scene.background = new THREE.Color('#83b5ce'); scene.fog = new THREE.Fog('#a8c5d0', 250, 9000);
    const daySky = new THREE.Color('#83b5ce'); const nightSky = new THREE.Color('#17283a');
    camera = new THREE.PerspectiveCamera(48, 1, 0.1, 10000); updateCamera(THREE);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
    canvasHost.prepend(renderer.domElement);
    const hemisphereLight = new THREE.HemisphereLight('#e2f5ff', '#344153', 2.0); scene.add(hemisphereLight);
    const sunlight = new THREE.DirectionalLight('#fff1d6', 2.4); sunlight.position.set(-5, 8, 4); scene.add(sunlight);

    // Scenery uses a 10 m world unit; its inverse pose keeps the runway fixed in the world.
    horizonGroup = new THREE.Group(); scene.add(horizonGroup);
    const worldPosition = new THREE.Vector3(0, flight.altitude * feetToWorld, 0);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), makeMaterial(THREE, '#75afd0', { side: THREE.BackSide, roughness: 1 })); sky.position.set(0, -20, -700); horizonGroup.add(sky);
    const terrainGeometry = new THREE.PlaneGeometry(2000, 2400, 48, 56);
    const terrainPositions = terrainGeometry.attributes.position;
    const terrainColors = [];
    for (let index = 0; index < terrainPositions.count; index += 1) {
      const localX = terrainPositions.getX(index);
      const localY = terrainPositions.getY(index);
      const worldZ = -localY - 800;
      const airportFlat = Math.abs(localX) < 90 && worldZ < -220 && worldZ > -560;
      const elevation = airportFlat ? 0 : Math.sin(localX * .012) * 2.4 + Math.cos(worldZ * .009) * 1.8 + Math.sin((localX + worldZ) * .004) * 2.2;
      terrainPositions.setZ(index, elevation);
      const field = Math.sin(localX * .021) * Math.cos(worldZ * .017) > .3;
      terrainColors.push(field ? .37 : .29, field ? .48 : .39, field ? .27 : .23);
    }
    terrainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(terrainColors, 3));
    terrainGeometry.computeVertexNormals();
    const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    terrain.rotation.x = -Math.PI / 2; terrain.position.z = -800; horizonGroup.add(terrain);
    const terrainHeightAt = (x, z) => Math.abs(x) < 90 && z < runway.nearZ + 80 && z > runway.farZ - 80
      ? 0
      : Math.sin(x * .012) * 2.4 + Math.cos(z * .009) * 1.8 + Math.sin((x + z) * .004) * 2.2;

    const flatMaterial = (color) => new THREE.MeshStandardMaterial({ color, roughness: .96, metalness: .02, side: THREE.DoubleSide });
    const asphalt = flatMaterial('#343c40');
    const concrete = flatMaterial('#777d78');
    const fieldMats = ['#73845b', '#849068', '#6f8058', '#91885c'].map((color) => flatMaterial(color));
    const groundRect = (width, length, x, z, material, y = .035) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), material);
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); horizonGroup.add(mesh); return mesh;
    };
    const groundBox = (size, position, material) => box(THREE, horizonGroup, size, position, material);
    groundRect(58, 64, -420, -760, fieldMats[0], .015);
    groundRect(90, 72, 390, -720, fieldMats[1], .016);
    groundRect(70, 90, -360, -1260, fieldMats[2], .018);
    groundRect(110, 75, 430, -1290, fieldMats[3], .02);

    const roadMaterial = flatMaterial('#555d5d');
    groundRect(5, 930, 285, -810, roadMaterial, .035);
    groundRect(360, 4, 105, -1120, roadMaterial, .035);
    const riverMat = new THREE.MeshStandardMaterial({ color: '#397c91', roughness: .28, metalness: .18, side: THREE.DoubleSide });
    const riverSegments = [[-620, -950, 160, -18], [-500, -1015, 150, 18], [-385, -1100, 160, -18], [-250, -1180, 170, 15]];
    for (const [x, z, length, angle] of riverSegments) { const water = groundRect(14, length, x, z, riverMat, .025); water.rotation.y = THREE.MathUtils.degToRad(angle); }
    const lake = groundRect(130, 75, -620, -1300, riverMat, .027); lake.rotation.y = -.22;

    const runwayBase = groundRect(runway.width + .5, runway.length + 12, runway.centerX, (runway.nearZ + runway.farZ) / 2, concrete, .045);
    runwayBase.name = 'runway-foundation';
    groundRect(runway.width, runway.length, runway.centerX, (runway.nearZ + runway.farZ) / 2, asphalt, .065).name = 'runway-36-18';
    const marking = new THREE.MeshBasicMaterial({ color: '#f5f6ef', side: THREE.DoubleSide });
    for (const edgeX of [-runway.width / 2 + .16, runway.width / 2 - .16]) groundBox([.12, .025, runway.length - 4], [edgeX, .085, (runway.nearZ + runway.farZ) / 2], marking);
    for (let z = runway.nearZ + 13; z < runway.farZ - 8; z += 13) groundBox([.22, .025, 6], [0, .09, -z], marking);
    const paintThreshold = (z, reverse = false) => {
      for (let stripe = -2; stripe <= 2; stripe += 1) groundBox([.38, .025, 4.5], [stripe * .78, .092, z], marking);
      for (const offset of [17, 27]) for (const side of [-1, 1]) groundBox([.42, .025, 5], [side * .78, .092, reverse ? z + offset : z - offset], marking);
    };
    paintThreshold(runway.nearZ + 5);
    paintThreshold(runway.farZ - 5, true);
    const makeRunwayNumber = (text, z, upsideDown = false) => {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
      const context = canvas.getContext('2d'); context.clearRect(0, 0, 256, 256); context.fillStyle = '#fff'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = '900 170px Arial'; context.fillText(text, 128, 128);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const number = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 4), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }));
      number.rotation.x = -Math.PI / 2; if (upsideDown) number.rotation.z = Math.PI; number.position.set(0, .1, z); horizonGroup.add(number);
    };
    makeRunwayNumber('36', runway.nearZ + 13); makeRunwayNumber('18', runway.farZ - 13, true);
    const taxiway = groundRect(5.5, 85, 8.5, -340, concrete, .05);
    taxiway.name = 'taxiway-link';
    groundRect(5.5, 64, 8.5, -340, asphalt, .072);
    groundRect(6, 34, 5.4, -350, concrete, .05);
    groundRect(48, 48, 33, -365, concrete, .052);
    groundRect(44, 44, 33, -365, asphalt, .073);
    groundBox([.16, .025, 48], [8.5, .09, -340], marking);
    for (const z of [-350, -360, -370, -380]) groundBox([.3, .025, 5], [33, .09, z], marking);

    const lightPositions = [];
    for (let z = runway.nearZ + 3; z >= runway.farZ - 3; z -= 6) for (const x of [-runway.width / 2 - .35, runway.width / 2 + .35]) lightPositions.push([x, .14, z]);
    for (let z = runway.nearZ + 4; z > runway.nearZ - 42; z -= 4) lightPositions.push([0, .16, z]);
    const lightGeometry = new THREE.SphereGeometry(.14, 6, 5);
    const lightMaterial = new THREE.MeshBasicMaterial({ color: '#f6f0d7' });
    const runwayLights = new THREE.InstancedMesh(lightGeometry, lightMaterial, lightPositions.length);
    const lightDummy = new THREE.Object3D();
    lightPositions.forEach(([x, y, z], index) => { lightDummy.position.set(x, y, z); lightDummy.updateMatrix(); runwayLights.setMatrixAt(index, lightDummy.matrix); });
    horizonGroup.add(runwayLights);
    const thresholdLampMaterial = new THREE.MeshBasicMaterial({ color: '#6ed4ec' });
    for (const x of [-runway.width / 2 - .55, runway.width / 2 + .55]) { const lamp = new THREE.Mesh(new THREE.BoxGeometry(.2, .14, .3), thresholdLampMaterial); lamp.position.set(x, .18, runway.nearZ + 2); horizonGroup.add(lamp); }

    const buildingMat = makeMaterial(THREE, '#c9d1c8', { roughness: .86 });
    const roofMat = makeMaterial(THREE, '#52616a', { roughness: .78 });
    const windowMat = new THREE.MeshBasicMaterial({ color: '#8bd5e7' });
    groundBox([24, 5, 10], [39, 2.5, -402], buildingMat);
    groundBox([24.5, .6, 10.5], [39, 5.25, -402], roofMat);
    for (let index = 0; index < 8; index += 1) groundBox([1.5, 1.6, .08], [29 + index * 2.8, 2.7, -396.92], windowMat);
    groundBox([5, 15, 5], [-38, 7.5, -395], buildingMat);
    groundBox([5.6, 1, 5.6], [-38, 15.5, -395], roofMat);
    groundBox([7, 8, 9], [58, 4, -350], buildingMat);
    groundBox([8, .7, 10], [58, 8.3, -350], roofMat);
    groundBox([12, 4, 7], [58, 2, -374], buildingMat);
    groundBox([12.5, .6, 7.5], [58, 4.3, -374], roofMat);

    const makeParkedPlane = (x, z, scale = 1) => {
      const plane = new THREE.Group(); plane.position.set(x, .5, z); plane.scale.setScalar(scale); horizonGroup.add(plane);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(.28, .34, 5, 8), makeMaterial(THREE, '#d7e3e7', { metalness: .26 })); body.rotation.x = Math.PI / 2; plane.add(body);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(4.4, .12, .72), makeMaterial(THREE, '#a9bdc6')); wing.position.z = .1; plane.add(wing);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(1.7, .1, .52), makeMaterial(THREE, '#658ca0')); tail.position.z = 2; plane.add(tail);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(.29, 1, 8), makeMaterial(THREE, '#e0eaed')); nose.rotation.x = -Math.PI / 2; nose.position.z = -2.75; plane.add(nose);
    };
    makeParkedPlane(22, -355, .8); makeParkedPlane(33, -355, .78); makeParkedPlane(43, -355, .82);

    const treePositions = [];
    for (const [centerX, centerZ, columns, rows, spacing] of [[-175, -570, 12, 12, 8], [145, -650, 11, 12, 9], [-260, -1450, 13, 9, 10]]) {
      for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
        const x = centerX + (column - columns / 2) * spacing + ((row * 7 + column * 3) % 5 - 2) * 1.3;
        const z = centerZ + (row - rows / 2) * spacing + ((column * 5 + row) % 7 - 3) * .9;
        if (Math.abs(x) < 72 && z > runway.farZ - 20 && z < runway.nearZ + 40) continue;
        treePositions.push([x, z, .75 + ((row * 3 + column * 7) % 8) * .07]);
      }
    }
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.28, .42, 3.2, 5), makeMaterial(THREE, '#5e5040'), treePositions.length);
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2.1, 6, 6), makeMaterial(THREE, '#385a45'), treePositions.length);
    treePositions.forEach(([x, z, scale], index) => { lightDummy.position.set(x, 1.6 * scale, z); lightDummy.scale.setScalar(scale); lightDummy.updateMatrix(); trunks.setMatrixAt(index, lightDummy.matrix); lightDummy.position.y = 5 * scale; lightDummy.updateMatrix(); crowns.setMatrixAt(index, lightDummy.matrix); });
    horizonGroup.add(trunks, crowns);

    const houseMat = makeMaterial(THREE, '#b8b09a', { roughness: .9 });
    const villageRoof = makeMaterial(THREE, '#754d3e', { roughness: .86 });
    for (let index = 0; index < 14; index += 1) {
      const x = 225 + (index % 4) * 18 + (Math.floor(index / 4) % 2) * 5;
      const z = -1120 - Math.floor(index / 4) * 20;
      groundBox([9, 5, 7], [x, 2.5, z], houseMat);
      groundBox([10, 1.3, 8], [x, 5.6, z], villageRoof);
    }
    const ridgeMaterial = makeMaterial(THREE, '#586b63', { roughness: 1 });
    for (const [x, z, radius, height] of [[-760, -1750, 150, 100], [-430, -1850, 190, 130], [650, -1750, 175, 115], [850, -950, 150, 90]]) {
      const hill = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 7), ridgeMaterial); hill.position.set(x, height / 2 - 3, z); horizonGroup.add(hill);
    }
    const landmark = new THREE.Group(); landmark.position.set(-280, 0, -1080); horizonGroup.add(landmark);
    const markerPole = new THREE.Mesh(new THREE.CylinderGeometry(.5, .7, 15, 6), makeMaterial(THREE, '#60758a', { metalness: .45, roughness: .38 })); markerPole.position.y = 7.5; landmark.add(markerPole);
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(4, 0), new THREE.MeshBasicMaterial({ color: '#ffb547' })); marker.position.y = 17; landmark.add(marker);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(28, 12, 10), new THREE.MeshBasicMaterial({ color: '#fff0bd' })); sun.position.set(-800, 700, -1800); horizonGroup.add(sun);
    const cloudMat = new THREE.MeshStandardMaterial({ color: '#eef8fb', transparent: true, opacity: 0.78, roughness: 1 });
    for (const [x, y, z, scale] of [[-460, 110, -620, 36], [250, 145, -1050, 46], [730, 105, -530, 32], [-900, 180, -1450, 54], [980, 160, -1200, 48]]) {
      for (const [dx, dy, dz, factor] of [[0, 0, 0, 1], [1, .25, .08, .68], [-.85, .15, -.1, .72]]) { const cloud = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), cloudMat); cloud.position.set(x + dx * scale, y + dy * scale, z + dz * scale); cloud.scale.set(scale * factor * 1.3, scale * factor * .35, scale * factor * .65); horizonGroup.add(cloud); }
    }

    // Cabin shell, side rails, windscreen and front instrument fascia.
    const cabin = new THREE.Group(); scene.add(cabin);
    const shellMat = makeMaterial(THREE, '#26384b', { metalness: .24, roughness: .52 });
    const trimMat = makeMaterial(THREE, '#60758a', { metalness: .45, roughness: .38 });
    box(THREE, cabin, [8.4, .38, 12], [0, -1.15, 0], shellMat);
    box(THREE, cabin, [.35, 2.7, 9], [-4.05, .05, 1], shellMat);
    box(THREE, cabin, [.35, 2.7, 9], [4.05, .05, 1], shellMat);
    box(THREE, cabin, [8.2, .34, .45], [0, 1.3, 2.9], trimMat);
    box(THREE, cabin, [8.2, .34, .45], [0, 1.3, -3.2], trimMat);
    box(THREE, cabin, [.3, 3.2, .3], [-4, 2.7, -3.0], trimMat);
    box(THREE, cabin, [.3, 3.2, .3], [4, 2.7, -3.0], trimMat);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(7.8, 3.15), new THREE.MeshPhysicalMaterial({ color: '#9de1f4', transparent: true, opacity: .16, roughness: .08, metalness: .1, side: THREE.DoubleSide }));
    glass.position.set(0, 2.75, -3.05); cabin.add(glass);
    // Forward windshield bow and overhead frame make the glass readable in depth.
    const barGeo = new THREE.CylinderGeometry(.055, .055, 3.5, 10);
    for (const x of [-2.65, 0, 2.65]) { const bar = new THREE.Mesh(barGeo, trimMat); bar.position.set(x, 2.75, -3.18); cabin.add(bar); }
    const overhead = box(THREE, cabin, [8.2, .24, .42], [0, 4.34, -2.98], shellMat); overhead.rotation.x = -.1;

    const panel = box(THREE, cabin, [8, 2.35, .65], [0, .2, -1.3], makeMaterial(THREE, '#283c51', { metalness: .28, roughness: .6 }));
    panel.rotation.x = -.08;
    const gaugePositions = [[-2.7, .63], [-.9, .63], [.9, .63], [2.7, .63], [-1.45, -.32], [1.45, -.32]];
    const controlTargets = [];
    instruments.slice(0, 6).forEach((item, index) => {
      const [x, y] = gaugePositions[index];
      const group = new THREE.Group(); group.position.set(x, y, - .91); cabin.add(group);
      const rimMat = makeMaterial(THREE, '#91a5b7', { metalness: .82, roughness: .28, emissive: '#000000' });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(.62, .075, 12, 48), rimMat); group.add(rim);
      const face = new THREE.Mesh(new THREE.CircleGeometry(.57, 48), new THREE.MeshBasicMaterial({ map: createGaugeTexture(THREE, item) })); group.add(face);
      const needleShape = new THREE.Shape(); needleShape.moveTo(-.035, -.09); needleShape.lineTo(0, .38); needleShape.lineTo(.035, -.09); needleShape.lineTo(-.035, -.09);
      const needle = new THREE.Mesh(new THREE.ShapeGeometry(needleShape), new THREE.MeshBasicMaterial({ color: '#ff665d', side: THREE.DoubleSide })); needle.position.z = .025; group.add(needle);
      const hub = new THREE.Mesh(new THREE.CircleGeometry(.065, 20), new THREE.MeshBasicMaterial({ color: '#f5f8fc' })); hub.position.z = .03; group.add(hub);
      const hit = new THREE.Mesh(new THREE.CircleGeometry(.72, 32), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); hit.position.z = .04; hit.userData.instrument = item; group.add(hit); meshes.set(item.id, { hit, rimMat, needle });
      for (const dx of [-.49, .49]) for (const dy of [-.49, .49]) { const screw = new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 8), trimMat); screw.position.set(dx, dy, .055); group.add(screw); }
    });
    // Control column and wheel in front of the learner.
    yoke = new THREE.Group(); yoke.position.set(0, -.63, .15); cabin.add(yoke);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(.11, .16, 1.25, 16), trimMat); column.position.set(0, -.33, .08); yoke.add(column);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(.59, .095, 12, 48), makeMaterial(THREE, '#202c38', { metalness: .58, roughness: .34 })); wheel.position.set(0, .25, .28); yoke.add(wheel);
    wheel.userData.instrument = instruments.find((item) => item.id === 'controls'); controlTargets.push(wheel);
    box(THREE, yoke, [.15, .15, .5], [0, .25, .28], trimMat);
    for (const x of [-1.7, 1.7]) { const pedalStem = new THREE.Mesh(new THREE.CylinderGeometry(.07, .1, .72, 12), trimMat); pedalStem.rotation.x = -.28; pedalStem.position.set(x, - .79, .2); cabin.add(pedalStem); const pedal = box(THREE, cabin, [.72, .16, .24], [x, -1.08, .32], shellMat); pedal.rotation.z = x < 0 ? -.08 : .08; pedal.userData.instrument = instruments.find((item) => item.id === 'controls'); controlTargets.push(pedal); }
    // Console details and seat edges add cabin depth without external assets.
    box(THREE, cabin, [1.4, .32, 1.8], [0, -1.02, 1.7], makeMaterial(THREE, '#1b2b3b'));
    for (const x of [-3.83, 3.83]) box(THREE, cabin, [.16, .15, 7.5], [x, 1.16, .2], trimMat);

    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
    const resize = () => { if (!renderer || disposed) return; const rect = canvasHost.getBoundingClientRect(); const w = Math.max(1, rect.width), h = Math.max(1, rect.height); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvasHost); resize();
    const pointerMove = (event) => {
      const rect = renderer.domElement.getBoundingClientRect(); pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      if (dragPointer === event.pointerId) { cameraYaw = THREE.MathUtils.clamp(cameraYaw - event.movementX * .004, -1.0, 1.0); cameraPitch = Math.max(-.12, Math.min(.42, cameraPitch + event.movementY * .003)); updateCamera(THREE); return; }
      raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects([...meshes.values()].map((item) => item.hit).concat(controlTargets), false)[0];
      const next = hit?.object.userData.instrument || null;
      if (hovered !== next) { const previousRing = hovered && meshes.get(hovered.id)?.rimMat; if (previousRing) previousRing.emissive.set('#000000'); hovered = next; const nextRing = hovered && meshes.get(hovered.id)?.rimMat; if (nextRing) nextRing.emissive.set('#38bde8'); renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab'; }
    };
    const pointerDown = (event) => {
      if (event.button === 0) { const rect = renderer.domElement.getBoundingClientRect(); pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1); raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects([...meshes.values()].map((item) => item.hit).concat(controlTargets), false)[0]; if (hit) { setInfo(hit.object.userData.instrument, true); return; } }
      dragPointer = event.pointerId; renderer.domElement.setPointerCapture(event.pointerId); renderer.domElement.style.cursor = 'grabbing';
    };
    const pointerUp = () => { dragPointer = null; if (renderer?.domElement) renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab'; };
    const wheelZoom = (event) => { event.preventDefault(); cameraDistance = Math.max(3.1, Math.min(4.9, cameraDistance + event.deltaY * .003)); updateCamera(THREE); };
    renderer.domElement.addEventListener('pointermove', pointerMove); renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pointerUp); renderer.domElement.addEventListener('pointercancel', pointerUp); renderer.domElement.addEventListener('wheel', wheelZoom, { passive: false });
    const keyMap = { KeyW: 'w', ArrowUp: 'w', KeyS: 's', ArrowDown: 's', KeyA: 'a', ArrowLeft: 'a', KeyD: 'd', ArrowRight: 'd', KeyQ: 'q', KeyE: 'e', KeyF: 'flaps', KeyG: 'gear', KeyB: 'brakes', KeyR: 'reset', ShiftLeft: 'shift', ShiftRight: 'shift', ControlLeft: 'control', ControlRight: 'control' };
    const keyForEvent = (event) => {
      const key = event.key.toLowerCase();
      if (key === 'shift') return 'shift';
      if (key === 'control') return 'control';
      return keyMap[event.code] || (['w', 'a', 's', 'd', 'q', 'e'].includes(key) ? key : null);
    };
    const keyDown = (event) => {
      if (!active || event.target.matches?.('input,textarea,select,[contenteditable="true"]')) return;
      if (event.code === 'Escape') { event.preventDefault(); onExit(); return; }
      if (event.code === 'Space') {
        if (event.target.closest?.('button,a')) return;
        event.preventDefault();
        if (!event.repeat) setPaused(!paused);
        return;
      }
      const key = keyForEvent(event);
      if (!key) return;
      event.preventDefault();
      if (['flaps', 'gear', 'brakes', 'reset'].includes(key)) {
        if (event.repeat) return;
        if (key === 'flaps') setFlaps(flight.flaps >= 30 ? 0 : flight.flaps + 10);
        if (key === 'gear') setGear(!flight.gearDown);
        if (key === 'brakes') setBrakes(!flight.brakes);
        if (key === 'reset') resetFlight();
        return;
      }
      if (!paused) held.add(key);
    };
    const keyUp = (event) => { const key = keyForEvent(event); if (key) held.delete(key); };
    const clearHeld = () => held.clear();
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clearHeld);
    const readoutElements = {
      pitch: root.querySelector('#sim-pitch-value'), bank: root.querySelector('#sim-bank-value'),
      heading: root.querySelector('#sim-heading-value'), speed: root.querySelector('#sim-speed-value'),
      altitude: root.querySelector('#sim-altitude-value'), verticalSpeed: root.querySelector('#sim-vspeed-value'), flaps: root.querySelector('#sim-flaps-value'),
      throttle: root.querySelector('#sim-throttle-value'), throttleSlider: root.querySelector('#sim-throttle-control'), throttleText: root.querySelector('#sim-throttle-control-value'), rpm: root.querySelector('#sim-rpm-value'), info: root.querySelector('#sim-info-reading'),
      infoTitle: root.querySelector('#sim-info-title'),
    };
    let lastReadoutUpdate = 0;
    const relativeWorldPosition = new THREE.Vector3();
    const landingStageNames = ['Полёт к аэропорту', 'Снижение высоты', 'Выравнивание с полосой', 'Выпуск закрылков', 'Выпуск шасси', 'Стабилизация захода', 'Касание ВПП', 'Торможение и остановка'];
    const runwayContains = (x, z) => Math.abs(x - runway.centerX) <= runway.width / 2 && z <= runway.nearZ && z >= runway.farZ;
    const runwayBearing = () => (Math.atan2(runway.centerX - worldPosition.x, -(runway.nearZ - worldPosition.z)) * 180 / Math.PI + 360) % 360;
    const courseDifference = (first, second) => ((first - second + 540) % 360) - 180;
    const renderLandingReadouts = () => {
      const distance = Math.hypot(runway.centerX - worldPosition.x, runway.nearZ - worldPosition.z) * 10;
      const bearing = runwayBearing();
      const bearingError = courseDifference(bearing, flight.heading);
      const lateral = Math.round((worldPosition.x - runway.centerX) * 10);
      root.querySelector('#landing-distance').textContent = `${Math.round(distance)} м`;
      root.querySelector('#landing-bearing').textContent = `${String(Math.round(bearing) % 360).padStart(3, '0')}° · ${Math.abs(bearingError) < 1 ? 'на оси' : `${bearingError > 0 ? 'правее' : 'левее'} ${Math.abs(Math.round(bearingError))}°`}`;
      root.querySelector('#landing-alignment').textContent = `${lateral > 0 ? '+' : ''}${lateral} м · ${Math.abs(Math.round(bearingError))}°`;
      root.querySelector('#landing-stage-label').textContent = landingMission.active ? `${landingMission.stage + 1}/8 · ${landingStageNames[landingMission.stage]}` : landingMission.resultSent ? 'Результат' : 'Не начата';
      root.querySelector('#landing-stage-progress').style.width = `${landingMission.active ? landingMission.stage / 8 * 100 : landingMission.resultSent ? 100 : 0}%`;
      if (landingMission.active) {
        const tips = [
          'Лети к аэропорту. Ориентир и расстояние до порога видны справа.',
          'Начни плавное снижение, контролируя вертикальную скорость.',
          'Сопоставь курс с направлением полосы и удерживай её по центру.',
          'Выпусти закрылки минимум на 20° для захода.',
          'Проверь, что шасси выпущено до снижения к полосе.',
          'Стабилизируй скорость, курс, крен и вертикальную скорость.',
          'Касание произошло. Удерживай самолёт в пределах асфальта.',
          'Нажми и удерживай тормоза, пока скорость не упадёт почти до нуля.',
        ];
        root.querySelector('#landing-instructor-tip').textContent = `Алекс: ${tips[landingMission.stage]}`;
      }
    };
    const finishLandingEvaluation = (crashed = false) => {
      if (!landingMission.active || landingMission.resultSent) return;
      const touchdown = landingMission.touchdown || {};
      const checks = [
        { label: 'Касание в пределах полосы', points: touchdown.onRunway ? 30 : 0, maximum: 30 },
        { label: 'Скорость при касании', points: touchdown.speed >= 55 && touchdown.speed <= 100 ? 15 : touchdown.speed >= 45 && touchdown.speed <= 115 ? 8 : 0, maximum: 15 },
        { label: 'Устойчивость самолёта', points: Math.abs(touchdown.bank || 0) <= 8 && (touchdown.pitch || 0) >= -6 && (touchdown.pitch || 0) <= 12 && (touchdown.verticalSpeed || 0) >= -3000 && (touchdown.verticalSpeed || 0) <= -200 ? 15 : 0, maximum: 15 },
        { label: 'Шасси выпущено', points: touchdown.gearDown ? 10 : 0, maximum: 10 },
        { label: 'Закрылки от 20°', points: touchdown.flaps >= 20 ? 10 : 0, maximum: 10 },
        { label: 'Остановка на полосе', points: !crashed && runwayContains(worldPosition.x, worldPosition.z) ? 20 : 0, maximum: 20 },
      ];
      const score = checks.reduce((sum, item) => sum + item.points, 0);
      const passed = score >= 70 && checks[0].points > 0 && checks[3].points > 0 && checks[5].points > 0;
      const result = { passed, score, percent: score, errors: checks.filter((item) => item.points < item.maximum).length, checks, recommendation: passed ? 'Посадка завершена. Разбери оценку по каждому параметру.' : crashed ? 'Самолёт покинул безопасную зону. Повтори тренировку и скорректируй заход.' : 'Самолёт остановился, но обязательные критерии посадки выполнены не все.' };
      landingMission.active = false;
      landingMission.resultSent = true;
      const panel = root.querySelector('#landing-result');
      panel.classList.remove('hidden');
      panel.innerHTML = `<strong>${passed ? 'Посадка выполнена' : 'Тренировка завершена'} · ${score}/100</strong><ul>${checks.map((item) => `<li>${item.points}/${item.maximum} · ${item.label}</li>`).join('')}</ul><p>${result.recommendation}</p>`;
      root.querySelector('#landing-instructor-tip').textContent = `Алекс: ${result.recommendation}`;
      onLandingResult(result);
      renderLandingReadouts();
    };
    const handleGroundContact = () => {
      const groundHeight = runwayContains(worldPosition.x, worldPosition.z) ? .065 : terrainHeightAt(worldPosition.x, worldPosition.z);
      if (flight.onGround || worldPosition.y > groundHeight + .025) return;
      flight.altitude = Math.max(0, groundHeight / feetToWorld);
      worldPosition.y = groundHeight;
      const touchdownVerticalSpeed = flight.verticalSpeed;
      flight.verticalSpeed = 0;
      flight.onGround = true;
      const onRunway = runwayContains(worldPosition.x, worldPosition.z);
      landingMission.touchdown = { onRunway, speed: flight.speed, pitch: flight.pitch, bank: flight.bank, verticalSpeed: touchdownVerticalSpeed, gearDown: flight.gearDown, flaps: flight.flaps };
      setBrakes(false);
      setSpoilers(flight.spoilers);
      if (!onRunway || !flight.gearDown) {
        flight.crashed = true;
        flight.speed = 0;
        setState(onRunway ? 'КАСАНИЕ · ШАССИ УБРАНЫ' : 'ВНЕ ПОЛОСЫ', 'error');
        finishLandingEvaluation(true);
      } else {
        setState('КАСАНИЕ · НА ВПП', 'ready');
        if (landingMission.active) landingMission.stage = Math.max(landingMission.stage, 6);
      }
    };
    const updateLandingMission = (dt) => {
      if (!landingMission.active) return;
      const previousStage = landingMission.stage;
      const distanceMeters = Math.hypot(runway.centerX - worldPosition.x, runway.nearZ - worldPosition.z) * 10;
      const headingError = Math.abs(courseDifference(runwayBearing(), flight.heading));
      const aligned = Math.abs(worldPosition.x - runway.centerX) <= 10 && headingError <= 12;
      if (landingMission.stage === 0 && distanceMeters <= 2200) landingMission.stage = 1;
      if (landingMission.stage === 1 && flight.altitude <= 2000) landingMission.stage = 2;
      if (landingMission.stage === 2 && aligned) landingMission.stage = 3;
      if (landingMission.stage === 3 && flight.flaps >= 20) landingMission.stage = 4;
      if (landingMission.stage === 4 && flight.gearDown) landingMission.stage = 5;
      if (landingMission.stage === 5) {
        const stable = flight.speed >= 55 && flight.speed <= 105 && flight.verticalSpeed <= -200 && flight.verticalSpeed >= -3000 && Math.abs(flight.bank) <= 10 && headingError <= 12;
        landingMission.stableSeconds = stable ? landingMission.stableSeconds + dt : 0;
        if (landingMission.stableSeconds >= 2) landingMission.stage = 6;
      }
      if (flight.onGround && landingMission.stage <= 6) landingMission.stage = 7;
      if (landingMission.stage !== previousStage) onLandingProgress({ stage: landingMission.stage, touchdown: landingMission.touchdown });
      if (flight.onGround && flight.speed <= 5 && landingMission.stage === 7) finishLandingEvaluation(false);
    };
    const resetFlight = () => {
      const missionWasActive = landingMission.active;
      Object.assign(flight, defaultFlight);
      flight.crashed = false;
      worldPosition.set(0, flight.altitude * feetToWorld, missionWasActive ? -850 : 0);
      landingMission.active = missionWasActive;
      landingMission.stage = 0;
      landingMission.stableSeconds = 0;
      landingMission.resultSent = false;
      landingMission.touchdown = null;
      root.querySelector('#landing-result').classList.add('hidden');
      cameraYaw = 0; cameraPitch = .03; cameraDistance = 4.1; updateCamera(THREE);
      setFlaps(flight.flaps); setGear(flight.gearDown); setBrakes(false); setSpoilers(flight.spoilers); setTrim(flight.trim);
      setState(active ? 'В ПОЛЁТЕ' : 'ПРИОСТАНОВЛЕН', 'ready');
      renderLandingReadouts(); setInfo(instruments[0]);
    };
    const startLandingMission = ({ tracked = false } = {}) => {
      if (!tracked && onLandingMissionStart() === false) return false;
      landingMission.active = true;
      landingMission.resultSent = false;
      resetFlight();
      flight.altitude = 2500;
      flight.speed = 95;
      worldPosition.set(0, flight.altitude * feetToWorld, -850);
      landingMission.active = true;
      landingMission.stage = 0;
      root.querySelector('#landing-result').classList.add('hidden');
      renderLandingReadouts();
      return true;
    };
    const updateReadouts = (time) => {
      if (time - lastReadoutUpdate >= 100) {
        lastReadoutUpdate = time;
        readoutElements.pitch.textContent = `${Math.round(flight.pitch)}°`;
        readoutElements.bank.textContent = `${Math.round(flight.bank)}°`;
        readoutElements.heading.textContent = `${String(Math.round(flight.heading + 360) % 360).padStart(3, '0')}°`;
        readoutElements.speed.textContent = `${Math.round(flight.speed)} kt`;
        readoutElements.altitude.textContent = `${Math.round(flight.altitude)} ft`;
        readoutElements.verticalSpeed.textContent = `${flight.verticalSpeed > 0 ? '+' : ''}${Math.round(flight.verticalSpeed)} ft/min`;
        readoutElements.throttle.textContent = `${Math.round(flight.throttle * 100)}%`;
        readoutElements.throttleSlider.value = Math.round(flight.throttle * 100);
        readoutElements.throttleText.textContent = `${Math.round(flight.throttle * 100)}%`;
        readoutElements.rpm.textContent = `${Math.round(flight.rpm)} RPM`;
        readoutElements.flaps.textContent = `${flight.flaps}°`;
        renderLandingReadouts();
        const selected = instruments.find((item) => item.title === readoutElements.infoTitle.textContent);
        if (selected) readoutElements.info.textContent = selected.get(flight);
      }
      root.querySelector('#sim-pitch-value').textContent = `${Math.round(flight.pitch)}°`;
      root.querySelector('#sim-bank-value').textContent = `${Math.round(flight.bank)}°`;
      root.querySelector('#sim-heading-value').textContent = `${String(Math.round(flight.heading + 360) % 360).padStart(3, '0')}°`;
      root.querySelector('#sim-speed-value').textContent = `${Math.round(flight.speed)} kt`;
      root.querySelector('#sim-altitude-value').textContent = `${Math.round(flight.altitude)} ft`;
      for (const item of instruments.slice(0, 6)) { const { needle } = meshes.get(item.id); if (item.id === 'airspeed') needle.rotation.z = THREE.MathUtils.clamp((flight.speed - 95) * .018, -1.2, 1.2); else if (item.id === 'attitude') { needle.rotation.z = -flight.bank * Math.PI / 180; needle.position.y = flight.pitch * .008; } else if (item.id === 'altimeter') needle.rotation.z = -(flight.altitude % 10000) / 10000 * Math.PI * 2; else if (item.id === 'vertical-speed') needle.rotation.z = THREE.MathUtils.clamp(-flight.verticalSpeed * .00035, -1.2, 1.2); else if (item.id === 'compass') needle.rotation.z = -flight.heading * Math.PI / 180; else if (item.id === 'rpm') needle.rotation.z = THREE.MathUtils.clamp(-(flight.rpm - 1800) * .001, -1.4, 1.4); }
      yoke.rotation.x = THREE.MathUtils.degToRad(-flight.pitch * .7); yoke.rotation.z = THREE.MathUtils.degToRad(-flight.bank * .58);
      horizonGroup.rotation.z = THREE.MathUtils.degToRad(-flight.bank * .48);
    };
    const animate = (time) => {
      if (disposed || !active) { animationRunning = false; return; }
      animationId = requestAnimationFrame(animate);
      const dt = Math.min(.05, Math.max(0, (time - lastFrame) / 1000)); lastFrame = time;
      if (!paused) {
        const throttleInput = (held.has('shift') ? 1 : 0) - (held.has('control') ? 1 : 0);
        flight.throttle = THREE.MathUtils.clamp(flight.throttle + throttleInput * .42 * dt, 0, 1);
        flight.rpm = 900 + flight.throttle * 3250;
        const pitchInput = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0);
        const bankInput = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0);
        flight.pitch = THREE.MathUtils.clamp(flight.pitch + pitchInput * 20 * dt + (flight.trim * .3 - flight.pitch) * .18 * dt, -22, 22);
        flight.bank = THREE.MathUtils.clamp(flight.bank + bankInput * 42 * dt - flight.bank * .25 * dt, -48, 48);
        const yawInput = (held.has('e') ? 1 : 0) - (held.has('q') ? 1 : 0);
        const coordinatedTurn = Math.sin(THREE.MathUtils.degToRad(flight.bank)) * 24;
        flight.heading = ((flight.heading + (coordinatedTurn + yawInput * 32) * dt + 360) % 360);
        const flapDrag = flight.flaps * .24;
        const gearDrag = flight.gearDown ? 4 : 0;
        const targetSpeed = THREE.MathUtils.clamp(35 + flight.throttle * 150 - Math.max(0, flight.pitch) * .65 - flapDrag - gearDrag, 0, 180);
        if (!flight.onGround) flight.speed += (targetSpeed - flight.speed) * (1 - Math.exp(-.32 * dt));
        else {
          if (flight.throttle > .05 && !flight.brakes) flight.speed += (targetSpeed - flight.speed) * (1 - Math.exp(-.16 * dt));
          const groundDeceleration = flight.brakes ? 20 : flight.spoilers ? 8 : 1.15;
          flight.speed = Math.max(0, flight.speed - groundDeceleration * dt);
        }
        const effectivePitch = flight.pitch + flight.flaps * .12 + flight.trim * .15;
        const pitchRadians = THREE.MathUtils.degToRad(effectivePitch);
        if (!flight.onGround) {
          flight.verticalSpeed = THREE.MathUtils.clamp(flight.speed * 101.2688 * Math.sin(pitchRadians), -3000, 3000);
          flight.altitude = THREE.MathUtils.clamp(flight.altitude + flight.verticalSpeed / 60 * dt, 0, 12000);
        } else {
          flight.verticalSpeed = 0;
          flight.altitude = worldPosition.y / feetToWorld;
          flight.pitch += (0 - flight.pitch) * .4 * dt;
          flight.bank += (0 - flight.bank) * .6 * dt;
        }
        worldPosition.y = flight.altitude * feetToWorld;
        handleGroundContact();
        const headingRadians = THREE.MathUtils.degToRad(flight.heading);
        const forward = new THREE.Vector3(Math.sin(headingRadians) * Math.cos(pitchRadians), flight.onGround ? 0 : Math.sin(pitchRadians), -Math.cos(headingRadians) * Math.cos(pitchRadians));
        worldPosition.addScaledVector(forward, flight.speed * .05144 * dt);
        if (flight.onGround) {
          const groundHeight = runwayContains(worldPosition.x, worldPosition.z) ? .065 : terrainHeightAt(worldPosition.x, worldPosition.z);
          worldPosition.y = groundHeight;
          flight.altitude = Math.max(0, groundHeight / feetToWorld);
        }
        relativeWorldPosition.copy(worldPosition).negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), headingRadians);
        horizonGroup.position.set(relativeWorldPosition.x, relativeWorldPosition.y - flight.pitch * .045, relativeWorldPosition.z);
        horizonGroup.rotation.y = headingRadians;
        updateLandingMission(dt);
      }
      const daylight = .5 + .5 * Math.sin(time * .000035);
      sunlight.intensity = .7 + daylight * 1.9;
      hemisphereLight.intensity = .8 + daylight * 1.2;
      scene.background.copy(nightSky).lerp(daySky, daylight);
      updateReadouts(time); renderer.render(scene, camera);
    };
    const startAnimation = () => {
      if (disposed || !active || animationRunning) return;
      animationRunning = true;
      lastFrame = performance.now();
      animationId = requestAnimationFrame(animate);
    };
    loading.remove();
    startAnimation();
    const focusCanvas = () => canvasHost.focus?.();
    canvasHost.addEventListener('pointerdown', focusCanvas);
    canvasHost.tabIndex = 0;
    root.querySelectorAll('[data-flight-key]').forEach((button) => {
      const key = button.dataset.flightKey;
      const down = (event) => { event.preventDefault(); if (!paused) held.add(key); button.classList.add('pressed'); };
      const up = () => { held.delete(key); button.classList.remove('pressed'); };
      button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up); button.addEventListener('pointerleave', up); button.addEventListener('pointercancel', up);
      button._simCleanup = () => { button.removeEventListener('pointerdown', down); button.removeEventListener('pointerup', up); button.removeEventListener('pointerleave', up); button.removeEventListener('pointercancel', up); };
    });
    const systemHandlers = [];
    const addSystemHandler = (selector, handler) => root.querySelectorAll(selector).forEach((button) => {
      button.addEventListener('click', handler);
      systemHandlers.push([button, handler]);
    });
    addSystemHandler('[data-flaps]', (event) => setFlaps(event.currentTarget.dataset.flaps));
    addSystemHandler('[data-gear-toggle]', () => setGear(!flight.gearDown));
    addSystemHandler('[data-brakes-toggle]', () => setBrakes(!flight.brakes));
    addSystemHandler('[data-spoilers-toggle]', () => setSpoilers(!flight.spoilers));
    const throttleSlider = root.querySelector('#sim-throttle-control');
    const throttleInputHandler = (event) => setThrottle(event.currentTarget.value);
    throttleSlider.addEventListener('input', throttleInputHandler);
    systemHandlers.push([throttleSlider, throttleInputHandler, 'input']);
    addSystemHandler('[data-trim]', (event) => setTrim(flight.trim + Number(event.currentTarget.dataset.trim)));
    addSystemHandler('[data-landing-start]', () => startLandingMission());
    const actionHandlers = [];
    root.querySelectorAll('[data-sim-action]').forEach((button) => {
      const handler = () => {
      if (button.dataset.simAction === 'pause') setPaused(!paused);
      if (button.dataset.simAction === 'exit') onExit();
      if (button.dataset.simAction === 'restart') { resetFlight(); setPaused(false); }
      };
      button.addEventListener('click', handler);
      actionHandlers.push([button, handler]);
    });
    setInfo(instruments[0]); if (active) setState('В ПОЛЁТЕ', 'ready'); else setPaused(true);
    setFlaps(flight.flaps); setGear(flight.gearDown); setBrakes(false); setSpoilers(flight.spoilers); setTrim(flight.trim); renderLandingReadouts();
    return { ready: true, startLandingMission, setActive(value) { active = Boolean(value); if (!active) { setPaused(true); cancelAnimationFrame(animationId); animationRunning = false; } else { resize(); startAnimation(); } }, setPaused, dispose() {
      if (disposed) return; disposed = true; active = false; held.clear(); cancelAnimationFrame(animationId); animationRunning = false; resizeObserver?.disconnect(); window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', clearHeld); canvasHost.removeEventListener('pointerdown', focusCanvas);
      renderer.domElement.removeEventListener('pointermove', pointerMove); renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pointerUp); renderer.domElement.removeEventListener('pointercancel', pointerUp); renderer.domElement.removeEventListener('wheel', wheelZoom);
      root.querySelectorAll('[data-flight-key]').forEach((button) => button._simCleanup?.());
      for (const [button, handler, eventName = 'click'] of systemHandlers) button.removeEventListener(eventName, handler);
      for (const [button, handler] of actionHandlers) button.removeEventListener('click', handler);
      for (const [button, handler] of systemHandlers) button.removeEventListener('click', handler);
      if (retryHandler) loading.querySelector('[data-sim-retry]')?.removeEventListener('click', retryHandler);
      scene.traverse((object) => {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
          material.dispose();
        }
      });
      renderer.dispose(); renderer.domElement.remove();
    } };
  };
  const controls = root.querySelectorAll('[data-sim-action]');
  controls.forEach((button) => button.disabled = true);
  const loadScene = () => import('three').then((THREE) => {
    if (disposed) return;
    const controller = buildScene(THREE);
    controls.forEach((button) => button.disabled = false);
    root._simController = controller;
    if (pendingLandingStart) {
      controller.startLandingMission(pendingLandingStart);
      pendingLandingStart = null;
    }
  }).catch((error) => {
    if (disposed) return;
    loading.innerHTML = `<b>Не удалось загрузить 3D-кабину</b><small>Проверь подключение к интернету и открой симулятор снова. ${String(error?.message || '').replace(/[<>&]/g, '')}</small><button type="button" data-sim-retry>Повторить загрузку</button>`;
    loading.classList.add('sim-load-error'); setState('ОШИБКА ЗАГРУЗКИ', 'error');
    retryHandler = () => { loading.innerHTML = '<span class="sim-spinner"></span><b>Загружаем 3D-кабину…</b><small>Подготавливаем приборы и сцену</small>'; loading.classList.remove('sim-load-error'); loadScene(); };
    loading.querySelector('[data-sim-retry]').addEventListener('click', retryHandler);
  });
  loadScene();
  return { ready: false, startLandingMission(options = {}) {
    if (disposed) return false;
    if (root._simController) return root._simController.startLandingMission(options);
    pendingLandingStart = options;
    return true;
  }, setActive(value) { if (disposed) return; active = Boolean(value); if (root._simController) root._simController.setActive(value); }, setPaused(value) { root._simController?.setPaused(value); }, dispose() {
    if (disposed) return;
    if (root._simController) {
      root._simController.dispose();
      root._simController = null;
    } else {
      disposed = true;
      pendingLandingStart = null;
      if (retryHandler) loading.querySelector('[data-sim-retry]')?.removeEventListener('click', retryHandler);
      loading.remove();
    }
  } };
}

/**
 * Interactive 3D instrument board used by the first lesson. Three.js is loaded
 * on demand so the rest of AeroPilot remains usable if the CDN is unavailable.
 * A keyboard friendly schematic is provided as a fallback.
 */
export async function initializeCockpitPractice(container, {
  tasks,
  completedTasks = [],
  initialMistakes = 0,
  onProgress = () => {},
  onMistake = () => {},
  onComplete = () => {},
} = {}) {
  if (!container || !tasks?.length) return null;
  const completed = new Set(completedTasks);
  let currentTask = tasks.find((task) => !completed.has(task.id)) || tasks[tasks.length - 1];
  let mistakes = initialMistakes;
  let disposed = false;
  let renderer;
  let resizeObserver;
  let cleanupScene = () => {};

  const frame = document.createElement('div');
  frame.className = 'cockpit-practice-frame';
  const stage = document.createElement('div');
  stage.className = 'cockpit-practice-canvas';
  const instructions = document.createElement('div');
  instructions.className = 'cockpit-practice-instructions';
  frame.append(stage, instructions);
  container.replaceChildren(frame);

  const updateInstructions = (message = '') => {
    const nextTask = tasks.find((task) => !completed.has(task.id));
    if (!nextTask) {
      instructions.innerHTML = `<b class="cockpit-success">Панель изучена ✓</b><span>Все приборы найдены. Практика завершена.</span>`;
      onComplete({ completedTasks: [...completed], mistakes });
      cleanupScene();
      return;
    }
    currentTask = nextTask;
    const count = completed.size;
    instructions.innerHTML = `<b>${escapeText(currentTask.prompt)}</b><span>Найдено: ${count} из ${tasks.length}</span>${message ? `<small>${escapeText(message)}</small>` : '<small>Выбери прибор на схеме.</small>'}`;
  };
  const markInstrument = (id, setHighlight = () => {}) => {
    if (disposed || !currentTask) return;
    if (id === currentTask.id) {
      completed.add(id);
      setHighlight(true);
      onProgress({ completedTasks: [...completed], mistakes });
      updateInstructions('Правильно. Продолжай поиск следующего прибора.');
    } else {
      mistakes += 1;
      onMistake({ mistakes, expected: currentTask.id, selected: id });
      updateInstructions('Это другой прибор. Прочитай подписи и попробуй ещё раз.');
    }
  };

  try {
    const THREE = await import('three');
    if (disposed) return null;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#10243a');
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 50);
    camera.position.set(0, 0, 11.5);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight('#d8efff', '#27364a', 2.1));
    const keyLight = new THREE.DirectionalLight('#d7f2ff', 2.2);
    keyLight.position.set(-3, 4, 7);
    scene.add(keyLight);

    const panel = new THREE.Mesh(new THREE.BoxGeometry(8.7, 4.8, 0.45), new THREE.MeshStandardMaterial({ color: '#33465b', metalness: 0.45, roughness: 0.5 }));
    panel.position.z = -0.35;
    scene.add(panel);
    const instruments = [];
    const instrumentLabels = [
      { id: 'airspeed', short: 'ASI', label: 'AIRSPEED', value: '105' },
      { id: 'attitude', short: 'AI', label: 'ATTITUDE', value: 'HORIZON' },
      { id: 'altimeter', short: 'ALT', label: 'ALTIMETER', value: '2500' },
      { id: 'heading', short: 'HDG', label: 'HEADING', value: '270°' },
      { id: 'vertical-speed', short: 'VSI', label: 'VERT SPEED', value: '+0' },
      { id: 'tachometer', short: 'RPM', label: 'TACHOMETER', value: '2200' },
    ];
    const positions = [[-2.65, 1.05], [0, 1.05], [2.65, 1.05], [-2.65, -1.25], [0, -1.25], [2.65, -1.25]];
    const highlightMaterials = new Map();
    instrumentLabels.forEach((instrument, index) => {
      const [x, y] = positions[index];
      const faceMaterial = new THREE.MeshStandardMaterial({ map: makeInstrumentTexture(THREE, instrument), color: '#ffffff', roughness: 0.8, metalness: 0.05 });
      const face = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.76, 0.16, 48), new THREE.MeshStandardMaterial({ color: '#131e2c', metalness: 0.7, roughness: 0.35 }));
      face.rotation.x = Math.PI / 2;
      face.position.set(x, y, 0.08);
      scene.add(face);
      const dial = new THREE.Mesh(new THREE.CircleGeometry(0.66, 48), faceMaterial);
      dial.position.set(x, y, 0.18);
      dial.userData.instrumentId = instrument.id;
      scene.add(dial);
      instruments.push(dial);
      const ringMaterial = new THREE.MeshStandardMaterial({ color: completed.has(instrument.id) ? '#60d7a1' : '#7790a9', metalness: 0.72, roughness: 0.35 });
      highlightMaterials.set(instrument.id, ringMaterial);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.73, 0.045, 8, 48), ringMaterial);
      ring.position.set(x, y, 0.2);
      scene.add(ring);
      const screwGeometry = new THREE.SphereGeometry(0.055, 10, 10);
      for (const dx of [-0.68, 0.68]) for (const dy of [-0.68, 0.68]) {
        const screw = new THREE.Mesh(screwGeometry, new THREE.MeshStandardMaterial({ color: '#9db3c8', metalness: 0.85, roughness: 0.25 }));
        screw.position.set(x + dx, y + dy, 0.23);
        scene.add(screw);
      }
    });
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const resize = () => {
      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);
    const onPointer = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(instruments, false)[0];
      if (!hit) { updateInstructions('Нажми на один из приборов.'); return; }
      const id = hit.object.userData.instrumentId;
      markInstrument(id, (correct) => { if (correct) highlightMaterials.get(id).color.set('#60d7a1'); });
    };
    renderer.domElement.addEventListener('pointerdown', onPointer);
    let animationId;
    const render = () => { if (disposed) return; renderer.render(scene, camera); animationId = requestAnimationFrame(render); };
    render();
    updateInstructions();

    const fallbackDispose = () => {
      cancelAnimationFrame(animationId);
      resizeObserver?.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointer);
      renderer.dispose();
      scene.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material?.dispose?.();
      });
    };
    cleanupScene = () => { if (!disposed) { disposed = true; fallbackDispose(); } };
    return { ready: true, dispose() { cleanupScene(); } };
  } catch {
    if (disposed) return null;
    renderFallback(stage, completed, markInstrument);
    updateInstructions('Резервная интерактивная схема: нажимай кнопки приборов.');
    return { ready: false, dispose() { disposed = true; container.replaceChildren(); } };
  }
}

function renderFallback(stage, completed, markInstrument) {
  const fallback = document.createElement('div');
  fallback.className = 'cockpit-fallback-board';
  const labels = [
    { id: 'airspeed', label: 'Указатель воздушной скорости', short: 'ASI' },
    { id: 'attitude', label: 'Авиагоризонт', short: 'AI' },
    { id: 'altimeter', label: 'Высотомер', short: 'ALT' },
    { id: 'heading', label: 'Указатель курса', short: 'HDG' },
    { id: 'vertical-speed', label: 'Вертикальная скорость', short: 'VSI' },
    { id: 'tachometer', label: 'Тахометр', short: 'RPM' },
  ];
  fallback.innerHTML = labels.map((item) => `<button class="fallback-instrument ${completed.has(item.id) ? 'found' : ''}" data-instrument-id="${item.id}" ${completed.has(item.id) ? 'disabled' : ''}><span>${item.short}</span><small>${item.label}</small></button>`).join('');
  fallback.addEventListener('click', (event) => {
    const button = event.target.closest('[data-instrument-id]');
    if (!button || button.disabled) return;
    markInstrument(button.dataset.instrumentId, (correct) => { if (correct) button.classList.add('found'); });
    if (completed.has(button.dataset.instrumentId)) button.disabled = true;
  });
  stage.replaceChildren(fallback);
}

function makeInstrumentTexture(THREE, instrument) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const context = canvas.getContext('2d');
  context.fillStyle = '#eaf1f7'; context.beginPath(); context.arc(256, 256, 250, 0, Math.PI * 2); context.fill();
  context.strokeStyle = '#50677d'; context.lineWidth = 9;
  for (let index = 0; index < 12; index += 1) {
    const angle = index / 12 * Math.PI * 2;
    context.beginPath(); context.moveTo(256 + Math.sin(angle) * 183, 256 - Math.cos(angle) * 183); context.lineTo(256 + Math.sin(angle) * 210, 256 - Math.cos(angle) * 210); context.stroke();
  }
  context.fillStyle = '#20364a'; context.textAlign = 'center'; context.font = '700 62px Arial'; context.fillText(instrument.short, 256, 286);
  context.font = '600 27px Arial'; context.fillStyle = '#577188'; context.fillText(instrument.label, 256, 350);
  context.font = '500 24px Arial'; context.fillStyle = '#1788b1'; context.fillText(instrument.value, 256, 398);
  return new THREE.CanvasTexture(canvas);
}

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
