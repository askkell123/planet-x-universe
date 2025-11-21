import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

// Main application class
class PlanetExplorer {
  constructor() {
    // Scene, camera, renderer
    this.scene = new THREE.Scene();
    
    this.camera = new THREE.PerspectiveCamera(
      75, 
      window.innerWidth / window.innerHeight, 
      0.1, 
      2000
    );
    this.camera.position.set(0, 20, 70);
    
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true 
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Limit device pixel ratio to reduce GPU workload on high-DPI (Retina) screens.
    // Anything above ~1.5 offers diminishing visual returns but quadruples the pixel cost.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    
    // Add renderer to DOM
    document.getElementById('scene-container').appendChild(this.renderer.domElement);
    
    // Setup post-processing with bloom effect
    this.setupPostProcessing();
    
    // Texture loader
    this.textureLoader = new THREE.TextureLoader();
    
    // Image preloading cache
    this.imagePreloadCache = new Map();
    this.preloadedPlanets = new Set();
    
    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 1000;
    
    // Raycaster for selection
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
    // Selected planet state
    this.selectedPlanet = null;
    this.planetIndex = -1; // Track the current planet index for keyboard navigation
    
    // Camera animation state
    this.animating = false;
    
    // Track explored planets
    this.exploredPlanets = new Set();
    this.TOTAL_PLANETS = 11;
    
    // ---- Dynamic effects containers ----
    this.lasers = [];      // active laser beams for asteroid hits
    this.explosions = [];  // active explosion particle groups
    
    // UI elements
    this.planetInfoPanel = document.getElementById('planet-info-main');
    this.planetDetailsPanel = document.getElementById('planet-details');
    this.planetStatsPanel = document.getElementById('planet-stats');
    
    // ---- REUSABLE PREVIEW RENDERER (Optimization) ----
    this._previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this._previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this._previewScene = new THREE.Scene();
    this._previewCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this._previewCamera.position.z = 3;
    
    const previewLight = new THREE.DirectionalLight(0xffffff, 1);
    previewLight.position.set(1, 1, 1);
    this._previewScene.add(previewLight);
    
    this._previewMesh = null;
    this._previewAnimId = null;
    this._previewContainer = null;
    
    // Initialize
    this.init();

    /* ------------------------------------------------
       Performance-related timing helpers
       ------------------------------------------------ */
    // Track the previous frame time so we can cap FPS (battery saver)
    this._lastFrameTime = performance.now();
    // Target 30 fps instead of the default ~60 fps
    this._frameInterval = 1000 / 30; // ≈33 ms
    this._accumulatedTime = 0;

    /* -------------------- Idle-Detection -------------------- */
    // How long (ms) of no interaction before we consider the app idle
    this._idleTimeout = 60_000; // 60 seconds
    this._lastInteraction = performance.now();
    this._isIdle = false;

    // Helper bound once so we can add/remove easily
    this._resetIdleTimer = () => {
      this._lastInteraction = performance.now();
      if (this._isIdle) {
        this._isIdle = false;
      }
    };

    this._registerIdleListeners();

    // Loading screen elements & default manager setup
    const loadingScreenEl = document.getElementById('loading-screen');
    const loadingPercentEl = document.querySelector('.loading-percentage');
    const loadingBarFillEl = document.querySelector('.loading-bar-fill');

    const manager = THREE.DefaultLoadingManager;
    manager.onProgress = (url, loaded, total) => {
      if (!loadingPercentEl || !loadingBarFillEl) return;
      const pct = Math.round((loaded / total) * 100);
      loadingPercentEl.textContent = `${pct}%`;
      loadingBarFillEl.style.width = `${pct}%`;
    };
    manager.onLoad = () => {
      if (loadingPercentEl) loadingPercentEl.textContent = '100%';
      if (loadingBarFillEl) loadingBarFillEl.style.width = '100%';
      
      // Preload images for the initially focused planet (Planet-X)
      this.preloadPlanetImages('planet-x');
      
      setTimeout(() => {
        loadingScreenEl?.classList.add('hidden');
      }, 400);
    };
  }
  
  /* ----------------------------------------------------------
     Set up global listeners that mark user activity
  ---------------------------------------------------------- */
  _registerIdleListeners() {
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'];
    events.forEach(evt => window.addEventListener(evt, this._resetIdleTimer, { passive: true }));

    // Use OrbitControls change as activity too (already exists)
    this.controls?.addEventListener('change', this._resetIdleTimer);
  }
  
  // Set up post-processing for bloom effect
  setupPostProcessing() {
    // Create composer
    this.composer = new EffectComposer(this.renderer);
    
    // Add render pass
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);
    
    // Add bloom pass - REMOVED per user request
    /*
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.4,    // strength
      0.4,    // radius
      0.85    // threshold
    );
    this.composer.addPass(bloomPass);
    */
  }
  
  init() {
    // Add lights
    this.addLights();
    
    // Add starfield
    this.addStarfield();
    
    // Add flying asteroids
    this.addFlyingAsteroids();
    
    // Add planets
    this.createPlanets();
    
    // Get reference to UI elements
    this.planetInfoPanel = document.getElementById('planet-info-main');
    this.planetDetailsPanel = document.getElementById('planet-details');
    this.planetStatsPanel = document.getElementById('planet-stats');
    
    // Initially hide all planet info panels
    this.hidePlanetInfo();
    
    // Setup zoom tracking for planet deselection
    this.setupZoomTracking();
    
    // Event listeners
    window.addEventListener('resize', () => this.onWindowResize());
    window.addEventListener('click', (event) => this.onMouseClick(event));
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    
    // Mouse move event to track when the cursor is over a planet
    window.addEventListener('mousemove', (event) => this.onMouseMove(event));
    
    // Setup mobile navigation arrows
    this.setupMobileNavigation();
    
    // Start animation loop
    this.animate();

    /* ---------------- Controls Overlay ---------------- */
    const controlsBtn = document.getElementById('controls-btn');
    const controlsOverlay = document.getElementById('controls-overlay');
    const closeControlsBtn = document.querySelector('.close-controls');

    if (controlsBtn && controlsOverlay && closeControlsBtn) {
      controlsBtn.addEventListener('click', () => {
        controlsOverlay.classList.add('visible');
        const logo = document.getElementById('scene-logo');
        if (logo) logo.classList.add('logo-black');
      });
      closeControlsBtn.addEventListener('click', () => {
        controlsOverlay.classList.remove('visible');
        const logo = document.getElementById('scene-logo');
        if (logo) logo.classList.remove('logo-black');
      });
    }
  }
  
  addLights() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    this.scene.add(ambientLight);
    
    // Directional light (sun-like) - repositioned to come from behind the camera to the right
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(20, 15, 50);  // Behind camera (z positive) and to the right (x positive)
    this.scene.add(sunLight);
    
    // Add a point light at the center for extra planetary illumination
    const centerLight = new THREE.PointLight(0xffffff, 0.5);  // Reduced intensity
    centerLight.position.set(0, 0, 0);
    this.scene.add(centerLight);
  }
  
  addStarfield() {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 8000;
    const positions = new Float32Array(starCount * 3);
    
    for (let i = 0; i < starCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 2000;
      positions[i + 1] = (Math.random() - 0.5) * 2000;
      positions[i + 2] = (Math.random() - 0.5) * 2000;
    }
    
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.6,
      transparent: true,
      opacity: 0.8
    });
    
    this.starfield = new THREE.Points(starGeometry, starMaterial);
    this.scene.add(this.starfield);
  }
  
  addNebulaSkybox() {
    /* // Entire method body commented out to prevent execution
    const loader = new THREE.TextureLoader();
    loader.load('textures/skybox-texture.png', (texture) => {
      // Create an inverted sphere so we view texture from inside
      const geometry = new THREE.SphereGeometry(1200, 64, 64);
      geometry.scale(-1, 1, 1); // Invert the sphere

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.6, // Adjust as needed for desired faintness
        depthWrite: false, // Important for transparency to work well with other objects
        blending: THREE.AdditiveBlending // For a brighter, more ethereal look
      });

      this.nebulaSkybox = new THREE.Mesh(geometry, material);
      this.scene.add(this.nebulaSkybox);
    });
    */
  }
  
  addFlyingAsteroids() {
    // Parameters for flying asteroids
    const asteroidCount = 150;
    const minSize = 0.2;
    const maxSize = 1.2;
    const speedFactor = 0.05;
    const spawnRadius = 500; // How far asteroids can spawn from center
    
    // Store on instance for later bounds checking
    this.asteroidSpawnRadius = spawnRadius;
    
    // Create container for asteroids
    this.asteroids = [];
    
    // Create a shared geometry for performance
    const asteroidGeometries = [
      new THREE.IcosahedronGeometry(1, 0), // Low poly icosahedron
      new THREE.TetrahedronGeometry(1, 0), // Low poly tetrahedron
      new THREE.DodecahedronGeometry(1, 0) // Low poly dodecahedron
    ];
    
    // Create materials with random colors in gray/brown tones
    const materials = [];
    for (let i = 0; i < 5; i++) {
      const hue = 0.05 + Math.random() * 0.1; // Brown/gray hue
      const saturation = 0.1 + Math.random() * 0.3; // Low saturation
      const lightness = 0.2 + Math.random() * 0.2; // Darker materials
      
      materials.push(new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hue, saturation, lightness),
        roughness: 0.8 + Math.random() * 0.2,
        metalness: 0.1 + Math.random() * 0.2
      }));
    }
    
    // Create each asteroid
    for (let i = 0; i < asteroidCount; i++) {
      // Randomly select geometry and material
      const geometry = asteroidGeometries[Math.floor(Math.random() * asteroidGeometries.length)];
      const material = materials[Math.floor(Math.random() * materials.length)];
      
      // Create mesh
      const asteroid = new THREE.Mesh(geometry, material);
      
      // Random position within spawn radius but not too close to center
      let position = new THREE.Vector3(
        (Math.random() - 0.5) * spawnRadius,
        (Math.random() - 0.5) * spawnRadius,
        (Math.random() - 0.5) * spawnRadius
      );
      
      // Ensure asteroids don't spawn too close to the center
      const distanceFromCenter = position.length();
      if (distanceFromCenter < 50) {
        position.normalize().multiplyScalar(50 + Math.random() * 50);
      }
      
      asteroid.position.copy(position);
      
      // Random size
      const scale = minSize + Math.random() * (maxSize - minSize);
      asteroid.scale.set(scale, scale, scale);
      
      // Random rotation
      asteroid.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );
      
      // Random velocity
      asteroid.userData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * speedFactor,
        (Math.random() - 0.5) * speedFactor,
        (Math.random() - 0.5) * speedFactor
      );
      
      // Random rotation speed
      asteroid.userData.rotationSpeed = new THREE.Vector3(
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.02
      );
      
      // Mark as asteroid for interaction checks
      asteroid.userData.isAsteroid = true;
      
      // Add to scene and array
      this.scene.add(asteroid);
      this.asteroids.push(asteroid);
    }
  }
  
  createPlanets() {
    this.planets = [];
    
    const planetData = [
      { 
        name: 'planet-x', 
        position: new THREE.Vector3(0, 0, 0),
        color: 0xff3300,
        size: 7,
        hasRings: true,
        ringColor: 0xff6600,
        rotationSpeed: 0.005
      },
      { 
        name: 'rath', 
        position: new THREE.Vector3(80, 30, -100),
        color: 0x00ff00,
        size: 5,
        hasAtmosphere: true,
        atmosphereColor: 0x00ff00,
        rotationSpeed: 0.007
      },
      { 
        name: 'drakko', 
        position: new THREE.Vector3(-110, -45, 60),
        color: 0x0000ff,
        size: 6,
        hasRings: true,
        ringColor: 0x000066,
        rotationSpeed: 0.004
      },
      { 
        name: 'aeronis', 
        position: new THREE.Vector3(70, -95, -70),
        color: 0xffff00,
        size: 4.5,
        hasAtmosphere: true,
        atmosphereColor: 0xffff00,
        rotationSpeed: 0.006
      },
      { 
        name: 'akaria', 
        position: new THREE.Vector3(-85, 90, 120),
        color: 0xff00ff,
        size: 5.5,
        hasRings: true,
        ringColor: 0xff00ff,
        rotationSpeed: 0.003
      },
      { 
        name: 'lyra', 
        position: new THREE.Vector3(120, -65, 40),
        color: 0x00ffff,
        size: 5,
        hasAtmosphere: true,
        atmosphereColor: 0x00ffff,
        rotationSpeed: 0.005
      },
      { 
        name: 'galeon', 
        position: new THREE.Vector3(-90, -120, -60),
        color: 0xff6600,
        size: 5.8,
        hasRings: true,
        ringColor: 0xff6600,
        rotationSpeed: 0.004
      },
      { 
        name: 'toppo', 
        position: new THREE.Vector3(100, 110, -90),
        color: 0x6600ff,
        size: 4.8,
        hasAtmosphere: true,
        atmosphereColor: 0x6600ff,
        rotationSpeed: 0.006
      },
      { 
        name: 'hestia', 
        position: new THREE.Vector3(-130, 60, 80),
        color: 0xff0066,
        size: 6.2,
        hasRings: true,
        ringColor: 0xff0066,
        rotationSpeed: 0.003
      },
      { 
        name: 'solara', 
        position: new THREE.Vector3(110, 85, 100),
        color: 0xffcc00,
        size: 5.2,
        hasAtmosphere: true,
        atmosphereColor: 0xffff00,
        rotationSpeed: 0.005
      },
      { 
        name: 'zepharo', 
        position: new THREE.Vector3(-65, -130, -110),
        color: 0x00ff66,
        size: 5,
        hasRings: true,
        ringColor: 0x00ff66,
        rotationSpeed: 0.004
      },
      { 
        name: 'planet-12',
        position: new THREE.Vector3(0, 0, -900),
        color: 0x999999,
        size: 6,
        rotationSpeed: 0.004
      }
    ];
    
    planetData.forEach(data => {
      const planet = this.createPlanet(data);
      this.planets.push(planet);
      this.scene.add(planet);
    });
  }
  
  createPlanet(data) {
    // Create planet group
    const planetGroup = new THREE.Group();
    planetGroup.position.copy(data.position);
    planetGroup.userData = {
      name: data.name,
      rotationSpeed: data.rotationSpeed
    };
    
    // Load texture for this planet
    const texture = this.textureLoader.load(`textures/${data.name}-texture.png`);
    
    // Create material with texture
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.6,
      metalness: 0.15
    });
    
    // Add a spotlight specifically for Drakko
    if (data.name === 'drakko') {
      const spotLight = new THREE.SpotLight(0xffffff, 0.8);
      spotLight.position.set(data.position.x + 15, data.position.y + 15, data.position.z + 15);
      spotLight.target = planetGroup;
      spotLight.angle = Math.PI / 6;
      spotLight.penumbra = 0.2;
      spotLight.distance = 100;
      spotLight.decay = 1;
      this.scene.add(spotLight);
    }
    
    // Add X-shaped asteroid belt around planet-x
    if (data.name === 'planet-x') {
      this.createXShapedAsteroidBelt(planetGroup, data.size);
    }
    
    // Planet mesh
    const geometry = new THREE.SphereGeometry(data.size, 32, 32);
    const planetMesh = new THREE.Mesh(geometry, material);
    planetGroup.add(planetMesh);
    
    return planetGroup;
  }
  
  createXShapedAsteroidBelt(planetGroup, planetSize) {
    // Parameters for the asteroid belt
    const particleCount = 2000;
    const ringRadius = planetSize * 1.8; // Reduced distance from planet center
    const ringThickness = planetSize * 0.6; // How thick the asteroid ring is
    const particleSize = 0.08; // Size of individual particles - reduced from 0.15
    
    // Create two particle systems for the two intersecting rings
    for (let ringIndex = 0; ringIndex < 2; ringIndex++) {
      // Create geometry for particles
      const particlesGeometry = new THREE.BufferGeometry();
      const positions = new Float32Array(particleCount * 3);
      const colors = new Float32Array(particleCount * 3);
      
      // Create particles in a ring shape
      for (let i = 0; i < particleCount; i++) {
        const i3 = i * 3;
        
        // Get angle around the ring (full circle)
        const angle = (Math.random() * Math.PI * 2);
        
        // Random distance from center line of the ring
        const distanceFromRing = (Math.random() - 0.5) * ringThickness;
        
        // Radius with slight variation
        const radius = ringRadius + (Math.random() - 0.5) * (ringThickness * 0.5);
        
        // Calculate positions differently for each ring to create X shape
        // First ring is tilted one way
        if (ringIndex === 0) {
          // First ring along XZ plane but tilted 45 degrees around Z
          positions[i3] = Math.cos(angle) * radius;
          positions[i3 + 1] = Math.sin(angle) * radius * Math.sin(Math.PI/4) + distanceFromRing * Math.cos(Math.PI/4);
          positions[i3 + 2] = Math.sin(angle) * radius * Math.cos(Math.PI/4) - distanceFromRing * Math.sin(Math.PI/4);
        } 
        // Second ring is tilted the other way
        else {
          // Second ring along XZ plane but tilted -45 degrees around Z
          positions[i3] = Math.cos(angle) * radius;
          positions[i3 + 1] = Math.sin(angle) * radius * Math.sin(-Math.PI/4) + distanceFromRing * Math.cos(-Math.PI/4);
          positions[i3 + 2] = Math.sin(angle) * radius * Math.cos(-Math.PI/4) - distanceFromRing * Math.sin(-Math.PI/4);
        }
        
        // Dark grey color for all particles
        const greyValue = 0.3 + Math.random() * 0.1; // Dark grey with slight variation
        colors[i3] = greyValue; // Red
        colors[i3 + 1] = greyValue; // Green
        colors[i3 + 2] = greyValue; // Blue
      }
      
      // Add attributes to geometry
      particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      
      // Material with vertex colors and circular shape
      const particlesMaterial = new THREE.PointsMaterial({
        size: particleSize,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        sizeAttenuation: true,
        map: this.createCircleTexture(), // Create circular texture
        alphaTest: 0.5 // Discard pixels with alpha < 0.5
      });
      
      // Create the particle system
      const particleSystem = new THREE.Points(particlesGeometry, particlesMaterial);
      
      // Make particles non-interactive for cursor events
      particleSystem.userData.noInteractive = true;
      
      // Add animation data
      particleSystem.userData = {
        rotationAxis: new THREE.Vector3(ringIndex === 0 ? 1 : -1, 0, 1).normalize(),
        rotationSpeed: 0.0005,
        planetRef: planetGroup, // Reference to the planet
        noInteractive: true // Flag to skip this object in raycasting
      };
      
      // Add to scene instead of planet group, so they don't rotate with the planet
      this.scene.add(particleSystem);
      
      // Store reference to the asteroid belts
      this.asteroidBelts = this.asteroidBelts || [];
      this.asteroidBelts.push(particleSystem);
    }
  }
  
  // Helper method to create a circular texture for particles
  createCircleTexture() {
    const canvas = document.createElement('canvas');
    const size = 32;
    canvas.width = size;
    canvas.height = size;
    
    const context = canvas.getContext('2d');
    context.beginPath();
    context.arc(size/2, size/2, size/2, 0, Math.PI * 2, false);
    context.fillStyle = 'white';
    context.fill();
    
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }
  
  // Helper method to create optimized images with loading states
  createOptimizedImage(imagePath, altText, width, height) {
    const img = document.createElement('img');
    img.alt = altText;
    img.style.width = width || '100%';
    img.style.height = height || '100%';
    img.style.objectFit = 'cover';
    
    // Set explicit dimensions to prevent layout shift
    if (width && height) {
      img.width = parseInt(width);
      img.height = parseInt(height);
    }
    
    const markLoaded = () => {
      img.classList.add('loaded');
      const container = img.closest('.image-container');
      if (container) {
        container.classList.add('loaded');
      }
    };

    // Add loaded class when image finishes loading
    img.addEventListener('load', markLoaded);
    img.addEventListener('error', () => {
      console.warn('Failed to load image:', imagePath);
      // Still mark as loaded to show alt text/placeholder instead of infinite spinner
      markLoaded();
    });
    
    img.src = imagePath;

    // Check if already complete (e.g. from cache)
    if (img.complete) {
      markLoaded();
    }
    
    return img;
  }
  
  // Preload planet images
  preloadPlanetImages(planetName) {
    if (this.preloadedPlanets.has(planetName)) return;
    
    const imagePaths = [
      `images/${planetName}-hero.png`,
      `images/${planetName}-major-city.png`,
      `images/${planetName}-mothership.png`,
      `images/${planetName}-inhabitants.png`,
      `images/${planetName}-weapon.png`,
      `images/${planetName}-location-1.png`,
      `images/${planetName}-location-2.png`,
      `images/${planetName}-location-3.png`
    ];
    
    imagePaths.forEach(path => {
      if (!this.imagePreloadCache.has(path)) {
        const img = new Image();
        img.src = path;
        this.imagePreloadCache.set(path, img);
      }
    });
    
    this.preloadedPlanets.add(planetName);
  }
  
  onMouseClick(event) {
    // Ignore clicks that originate from UI overlays (Explore / Controls, etc.)
    const ignoreSelectors = ['.explore-button', '.controls-pill', '.close-modal', '.close-controls'];
    for (const sel of ignoreSelectors) {
      if (event.target.closest(sel)) {
        return; // Let the button's own handler run without Three.js interference
      }
    }
    
    if (this.animating) return;
    
    // Check for planet click
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    // Convert mouse position to normalized device coordinates
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // Set the raycaster based on mouse position and camera
    raycaster.setFromCamera(mouse, this.camera);
    
    // Filter out non-interactive objects for raycasting
    const interactiveObjects = this.scene.children.filter(obj => !obj.userData.noInteractive);
    
    // Check for intersections with planets
    const intersects = raycaster.intersectObjects(interactiveObjects, true);
    
    if (intersects.length > 0) {
      // ----- ASTEROID interaction -----
      if (intersects[0].object.userData && intersects[0].object.userData.isAsteroid) {
        const asteroidHit = intersects[0].object;
        this.shootLaserAt(asteroidHit);
        return; // stop further planet selection checks
      }
      
      // Try to find the parent planet group
      let planetObj = intersects[0].object;
      while (planetObj.parent && !this.planets.includes(planetObj)) {
        planetObj = planetObj.parent;
      }
      
      // If we found a planet in our planets array
      if (this.planets.includes(planetObj)) {
        // First hide current planet info
        this.hidePlanetInfo();
        
        // Find the index of the clicked planet
        this.currentPlanetIndex = this.planets.indexOf(planetObj);
        
        // Move camera to the planet - will trigger showPlanetInfo when complete
        const planetName = planetObj.userData.name;
        this.moveCamera(planetObj, planetName);
      }
    }
  }
  
  selectPlanet(planet) {
    // Reset previous selection
    this.selectedPlanet = planet;
    
    // Update planet index for keyboard navigation
    this.planetIndex = this.planets.findIndex(p => p === planet);
    
    // Show planet info
    this.showPlanetInfo(planet.userData.name);
    
    // Move camera to planet
    this.moveCamera(planet);
  }
  
  moveCamera(planet, planetName) {
    this.animating = true;
    
    // Disable controls during animation
    this.controls.enabled = false;
    
    // Target position (planet's position)
    const targetPosition = new THREE.Vector3();
    planet.getWorldPosition(targetPosition);
    
    // Calculate planet size
    const planetRadius = planet.children[0].geometry.parameters.radius || 5;
    
    // Calculate camera position to show planet centered in the viewport
    // Increased distance by 25% to make planet appear smaller
    const distance = planetRadius * 2.5; // Previously 2.0
    
    // Position camera to view planet directly from front
    const cameraTargetPosition = new THREE.Vector3()
      .copy(targetPosition)
      .add(new THREE.Vector3(
        0,               // Centered horizontally
        distance * 0.2,  // Slightly above
        distance * 1.1   // Distance from planet
      ));
    
    // Animation timing variables
    const startPosition = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const duration = 1500; // 1.5 seconds
    const startTime = Date.now();
    
    // Animation function
    const animate = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function (cubic in-out)
      const ease = progress < 0.5 
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      
      // Update camera position
      this.camera.position.lerpVectors(startPosition, cameraTargetPosition, ease);
      
      // Update controls target to be the center of the planet
      this.controls.target.lerpVectors(startTarget, targetPosition, ease);
      
      // Force controls update
      this.controls.update();
      
      // Continue animation if not complete
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Animation complete
        this.animating = false;
        this.controls.enabled = true;
        
        // Update orbit controls constraints - allow more zooming out
        this.controls.minDistance = planetRadius * 1.6; // Previously 1.3
        this.controls.maxDistance = planetRadius * 14.0; // allow zoom-out beyond deselection threshold
        
        // Update orbit controls
        this.controls.update();
        
        // Update selected planet
        this.selectedPlanet = planet;
        this.isZoomedOut = false;
        
        // Now that the camera is in position, show the planet info
        if (planetName) {
          // Get the name from planet if it wasn't provided
          if (!planetName) {
            planetName = planet.name || planet.userData.name;
          }
          this.showPlanetInfo(planetName);
        }
      }
    };
    
    // Start animation
    animate();
  }
  
  showPlanetInfo(planetName) {
    // Ensure planet name fits within tablet viewport width
    const fitName = () => {
      if (window.innerWidth > 900) return; // only tablet/mobile
      const container = document.getElementById('planet-info-main');
      const el = container?.querySelector('.planet-name');
      if (!container || !el) return;
      // reset to base size first
      el.style.fontSize = '48px';
      el.style.whiteSpace = 'nowrap';
      const maxWidth = container.clientWidth * 0.9; // small padding
      let fontSize = parseFloat(window.getComputedStyle(el).fontSize);
      while (el.scrollWidth > maxWidth && fontSize > 12) {
        fontSize -= 1;
        el.style.fontSize = fontSize + 'px';
      }
    };
    
    // Update minimal view
    const planetNameEl = document.querySelector('.planet-name');
    // Determine planet index (01,02,...) for display
    const idx = this.planets.findIndex(p => p.userData.name.toLowerCase() === planetName.toLowerCase());
    const displayIndex = idx >= 0 ? String(idx + 1).padStart(2, '0') : '';

    // Store index on data attribute so CSS ::after can render it
    if (planetNameEl) {
      planetNameEl.setAttribute('data-index', displayIndex);
      this.applyTextReveal(planetNameEl, planetName.toUpperCase());
      const taglineEl = document.getElementById('scene-tagline');
      if (taglineEl) {
        this.scrambleText(taglineEl, `${planetName.toUpperCase()} // ${displayIndex}`);
      }
    }
    
    // Show minimal info panel
    const planetInfo = document.getElementById('planet-info-main');
    if (planetInfo) planetInfo.classList.add('visible');
    
    // Set up explore button click handler
    const exploreButton = document.querySelector('.explore-button');
    if (exploreButton) {
      // Remove any existing listener
      const newButton = exploreButton.cloneNode(true);
      exploreButton.parentNode.replaceChild(newButton, exploreButton);
      
      // Set default label
      const labelEl = newButton.querySelector('.planet-button-name') || newButton;
      labelEl.textContent = 'EXPLORE';

      if (planetName.toLowerCase() === 'planet-12') {
        // Unexplored planet special case
        labelEl.textContent = 'PLANET UNEXPLORED';
        newButton.addEventListener('click', () => {
          newButton.classList.add('shake');
          setTimeout(() => newButton.classList.remove('shake'), 600);
        });
      } else {
        // Normal behaviour
      newButton.addEventListener('click', () => {
        this.showPlanetModal(planetName);
      });
    }
    }
    
    // After updating name, fit within width (tablet)
    fitName();
  }
  
  // New method to load planet data from text files
  async loadPlanetData(planetName) {
    try {
      const response = await fetch(`text/${planetName.toLowerCase()}-text.txt`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const text = await response.text();
      const data = this.parsePlanetText(text, planetName);
      // console.log(`Loaded data for ${planetName}:`, data);
      return data;
    } catch (error) {
      console.error(`Error loading planet data for ${planetName}:`, error);
      return null;
    }
  }
  
  // Parse the text file content into structured data
  parsePlanetText(text, planetName) {
    // Initialize with default structure
    const data = {
      name: planetName,
      overview: '',
      stats: {
        temperature: '',
        population: '',
        dayLength: '',
        radius: '',
        majorCity: '',
        mothership: ''
      },
      locations: [],
      majorCity: {
        name: '',
        description: ''
      },
      mothership: {
        name: '',
        description: ''
      },
      inhabitants: {
        name: '',
        description: ''
      },
      leader: {
        name: '',
        description: ''
      },
      weapon: {
        name: '',
        description: ''
      }
    };
    
    // Split text into lines for parsing
    const lines = text.split('\n');
    
    // Variables to track current section
    let currentSection = '';
    let sectionContent = '';
    
    // Process each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines
      if (!line) continue;
      
      // Check for section headers
      if (line.includes('OVERVIEW:')) {
        currentSection = 'overview';
        continue;
      } else if (line.includes('STATS:')) {
        currentSection = 'stats';
        continue;
      } else if (line.includes('LOCATIONS:')) {
        currentSection = 'locations';
        continue;
      } else if (line.includes('MAJOR CITY:')) {
        currentSection = 'majorCity';
        continue;
      } else if (line.includes('MOTHERSHIP:')) {
        currentSection = 'mothership';
        continue;
      } else if (line.includes('INHABITANTS:')) {
        currentSection = 'inhabitants';
        continue;
      } else if (line.includes('LEADER:')) {
        currentSection = 'leader';
        continue;
      } else if (line.includes('WEAPON:')) {
        currentSection = 'weapon';
        continue;
      }
      
      // Process current section
      switch (currentSection) {
        case 'overview':
          data.overview += line + ' ';
          break;
          
        case 'stats':
          if (line.startsWith('Temperature:')) {
            data.stats.temperature = line.split(':')[1].trim();
          } else if (line.startsWith('Population:')) {
            data.stats.population = line.split(':')[1].trim();
          } else if (line.startsWith('Day Length:')) {
            data.stats.dayLength = line.split(':')[1].trim();
          } else if (line.startsWith('Radius:')) {
            data.stats.radius = line.split(':')[1].trim();
          } else if (line.startsWith('Major City:')) {
            data.stats.majorCity = line.split(':')[1].trim();
          } else if (line.startsWith('Mothership:')) {
            data.stats.mothership = line.split(':')[1].trim();
          }
          break;
          
        case 'locations':
          if (line.startsWith('-')) {
            const locationText = line.substring(1).trim();
            const colonIndex = locationText.indexOf(':');
            if (colonIndex > 0) {
              const name = locationText.substring(0, colonIndex).trim();
              const description = locationText.substring(colonIndex + 1).trim();
              data.locations.push({ name, description });
            } else {
              data.locations.push({ 
                name: locationText.split(':')[0].trim(),
                description: ''
              });
            }
          }
          break;
          
        case 'majorCity':
          if (line.startsWith('NAME:')) {
            data.majorCity.name = line.split(':')[1].trim();
          } else if (line.startsWith('DESCRIPTION:')) {
            data.majorCity.description = line.split(':')[1].trim();
          } else if (data.majorCity.description) {
            data.majorCity.description += ' ' + line;
          }
          break;
          
        case 'mothership':
          if (line.startsWith('NAME:')) {
            data.mothership.name = line.split(':')[1].trim();
          } else if (line.startsWith('DESCRIPTION:')) {
            data.mothership.description = line.split(':')[1].trim();
          } else if (data.mothership.description) {
            data.mothership.description += ' ' + line;
          }
          break;
          
        case 'inhabitants':
          if (line.startsWith('NAME:')) {
            data.inhabitants.name = line.split(':')[1].trim();
          } else if (line.startsWith('DESCRIPTION:')) {
            data.inhabitants.description = line.split(':')[1].trim();
          } else if (data.inhabitants.description) {
            data.inhabitants.description += ' ' + line;
          }
          break;
          
        case 'leader':
          if (line.startsWith('NAME:')) {
            data.leader.name = line.split(':')[1].trim();
          } else if (line.startsWith('DESCRIPTION:')) {
            data.leader.description = line.split(':')[1].trim();
          } else if (data.leader.description) {
            data.leader.description += ' ' + line;
          }
          break;
          
        case 'weapon':
          if (line.startsWith('NAME:')) {
            data.weapon.name = line.split(':')[1].trim();
          } else if (line.startsWith('DESCRIPTION:')) {
            data.weapon.description = line.split(':')[1].trim();
          } else if (data.weapon.description) {
            data.weapon.description += ' ' + line;
          }
          break;
      }
    }
    
    return data;
  }

  // Update the showPlanetModal method to use the loaded data
  async showPlanetModal(planetName) {
    const modal = document.getElementById('planet-modal');
    if (!modal) return;
    
    const modalWasVisible = modal.classList.contains('visible');
    
    // Load planet data
    const planetData = await this.loadPlanetData(planetName);
    
    // Get references to modal sections
    const heroSection = modal.querySelector('.hero-section');
    const heroBackground = modal.querySelector('.hero-section .section-background');
    const heroContentWrap = modal.querySelector('.hero-content-wrap');
    const planetStats = modal.querySelector('.planet-stats');
    
    // Make all sections unfade first
    const sections = modal.querySelectorAll('.modal-section');
    sections.forEach(section => {
      section.classList.remove('section-visible');
    });
    
    if (!modalWasVisible) {
    const insigniaSection = modal.querySelector('.insignia-section');
    if (insigniaSection) {
        const modalContent = modal.querySelector('.modal-content');
        // Override via inline style with !important
        if (modalContent) modalContent.style.setProperty('scroll-behavior', 'auto', 'important');
        insigniaSection.scrollIntoView({ behavior: 'auto', block: 'start' });
        if (modalContent) modalContent.style.removeProperty('scroll-behavior');
      }
    }
    
    if (heroBackground) {
      // Clone and replace to reset animations
      const newHeroBackground = heroBackground.cloneNode(true);
      heroBackground.parentNode.replaceChild(newHeroBackground, heroBackground);
    }
    
    if (heroContentWrap) {
      // Clone and replace to reset animations
      const newHeroContentWrap = heroContentWrap.cloneNode(true);
      heroContentWrap.parentNode.replaceChild(newHeroContentWrap, heroContentWrap);
    }
    
    if (planetStats) {
      // Clone and replace to reset animations
      const newPlanetStats = planetStats.cloneNode(true);
      planetStats.parentNode.replaceChild(newPlanetStats, planetStats);
    }
    
    // Update header content with reveal animation
    const planetNameElements = modal.querySelectorAll('.planet-name');
    planetNameElements.forEach(element => {
      this.applyTextReveal(element, planetName.toUpperCase());
    });
    
    // Get planet insignia paths
    const insigniaPath = `insignias/${planetName.toLowerCase()}-insignia.png`;
    
    // Set the regular insignia in the hero section
    const planetInsignia = modal.querySelector('.planet-insignia');
    if (planetInsignia) {
      planetInsignia.src = insigniaPath;
    }
    
    // Set the large centered insignia in the circular insignia section
    const largeInsignia = modal.querySelector('.planet-insignia-large');
    if (largeInsignia) {
      largeInsignia.src = insigniaPath;
    }
    
    // Set up the circular text for the insignia section
    const textPath = modal.querySelector('.planet-subtitle-text');
    if (textPath) {
      // Determine the subtitle for the planet
      let subtitle = '';
      
      switch(planetName.toLowerCase()) {
        case 'drakko':
          subtitle = 'THE WORLD OF ETERNAL FIRE';
          break;
        case 'planet-x':
          subtitle = 'THE MYSTERIOUS ELIXIR WORLD';
          break;
        case 'lyra':
          subtitle = 'THE OCEANIC REALM';
          break;
        case 'rath':
          subtitle = 'THE VERDANT FOREST WORLD';
          break;
        case 'aeronis':
          subtitle = 'THE KINGDOM IN THE CLOUDS';
          break;
        case 'toppo':
          subtitle = 'THE QUANTUM SYNTHESIS WORLD';
          break;
        case 'hestia':
          subtitle = 'THE BLAZING HEART';
          break;
        case 'zepharo':
          subtitle = 'THE ELECTRIC STORM WORLD';
          break;
        case 'galeon':
          subtitle = 'THE TEMPORAL NEXUS';
          break;
        case 'akaria':
          subtitle = 'THE CRYSTALLINE HARMONIC SPHERE';
          break;
        case 'solara':
          subtitle = 'THE RADIANT BEACON';
          break;
        default:
          subtitle = 'PLANETARY SYSTEM';
      }
      
      // Repeat the subtitle three times with spacing
      textPath.textContent = `${subtitle} • ${subtitle} • ${subtitle} •`;
    }
    
    // Set up scroll interaction for the circular text
    const modalContent = modal.querySelector('.modal-content');
    // Replace text-based circular tagline with SVG version
    const circularContainer = modal.querySelector('.circular-text-container');
    let rotateTarget = null;

    if (circularContainer) {
      // Remove existing tagline img if any
      const oldImg = circularContainer.querySelector('.planet-tagline');
      if (oldImg) oldImg.remove();

      // Hide old text-based svg
      const oldSvg = circularContainer.querySelector('.circular-text-svg');
      if (oldSvg) oldSvg.style.display = 'none';

      // Create new SVG img
      const tagImg = document.createElement('img');
      tagImg.className = 'planet-tagline';
      tagImg.src = `taglines/${planetName.toUpperCase()}-tagline.svg`;
      tagImg.alt = `${planetName} tagline`;
      circularContainer.appendChild(tagImg);

      rotateTarget = tagImg;
    }

    // Fallback to old circular text if tagImg not created
    if (!rotateTarget) {
      rotateTarget = modal.querySelector('.circular-text-svg');
    }
    
    /* -------------------- Helper to align tagline -------------------- */
    const alignTagline = () => {
      // ensure elements
      const insigniaImg = circularContainer?.querySelector('.planet-insignia-large');
      if (!rotateTarget || !insigniaImg) return;
      if (!insigniaImg.complete || insigniaImg.naturalWidth === 0) {
        insigniaImg.onload = alignTagline;
        return;
      }
      if (rotateTarget.tagName === 'IMG') {
        const tagImg = rotateTarget;
        if (!tagImg.complete || tagImg.naturalWidth === 0) {
          tagImg.onload = alignTagline;
          return;
        }
      }
      // Temporarily reset transform to just translate(-50%,-50%) for measurement
      const previousTransform = rotateTarget.style.transform;
      rotateTarget.style.transform = 'translate(-50%, -50%) scale(0.9)';

      // allow browser to layout
      requestAnimationFrame(() => {
        const skullRect = insigniaImg.getBoundingClientRect();
        const circleRect = rotateTarget.getBoundingClientRect();
        const skullCX = skullRect.left + skullRect.width / 2;
        const skullCY = skullRect.top + skullRect.height / 2;
        const circleCX = circleRect.left + circleRect.width / 2;
        const circleCY = circleRect.top + circleRect.height / 2;
        const deltaX = skullCX - circleCX;
        const deltaY = skullCY - circleCY;

        // Save deltas to instance for reuse in scroll listener
        this._taglineOffset = { x: Math.round(deltaX), y: Math.round(deltaY) };

        // Apply transform with offset + 0deg rotation
        this._taglineBaseTransform = `translate(calc(-50% + ${this._taglineOffset.x}px), calc(-50% + ${this._taglineOffset.y}px)) scale(0.9)`;
        rotateTarget.style.transform = `${this._taglineBaseTransform} rotate(0deg)`;

        // Restore previousTransform variable not needed; we override anyway
      });
    };

    // Call alignTagline once now
    alignTagline();

    // ----------------- end helper -----------------

    if (modalContent && rotateTarget) {
      // Clean up any existing listeners first
      if (this.scrollListener) {
        modalContent.removeEventListener('scroll', this.scrollListener);
      }
      
      // Create a new scroll listener
      this.scrollListener = () => {
         // Recompute offset to keep alignment on layout shifts
         alignTagline();

        const scrollPos = modalContent.scrollTop;
        const rotationAngle = scrollPos / 5;
         if (this._taglineBaseTransform) {
           rotateTarget.style.transform = `${this._taglineBaseTransform} rotate(${rotationAngle}deg)`;
         }
      };
      modalContent.addEventListener('scroll', this.scrollListener);
    }
    
    // Update hero image and planet description
    const heroImage = modal.querySelector('.hero-image');
    if (heroImage) {
      const imageUrl = `images/${planetName.toLowerCase()}-hero.png`;
        
      // Clear any existing content
      heroImage.innerHTML = '';
      
      // Add loading container class
      heroImage.classList.add('image-container');
      
      // Create and add the optimized image element
      const img = this.createOptimizedImage(imageUrl, `${planetName} surface`, '100%', '100%');
      heroImage.appendChild(img);
    }
    
    // Also update the background image for consistency
    const sectionBackground = modal.querySelector('.hero-section .section-background');
    if (sectionBackground) {
      const imageUrl = `images/${planetName.toLowerCase()}-hero.png`;
      sectionBackground.style.backgroundImage = `url('${imageUrl}')`;
    }
    
    // Update planet description
    const planetDescription = modal.querySelector('.planet-description');
    if (planetDescription && planetData) {
      planetDescription.textContent = planetData.overview;
    }
    
    // Update planet stats using data from the file
    let temperature, population, dayLength, radius, majorCity, mothership;
    
    if (planetData) {
      temperature = planetData.stats.temperature;
      population = planetData.stats.population;
      dayLength = planetData.stats.dayLength;
      radius = planetData.stats.radius;
      majorCity = planetData.majorCity.name || planetData.stats.majorCity;
      mothership = planetData.mothership.name || planetData.stats.mothership;
    } else {
      // Fallback to existing code
      switch(planetName.toLowerCase()) {
        case 'drakko':
          temperature = '857°C';
          population = '1.2 Billion';
          dayLength = '42 Hours';
          radius = '6,240 km';
          majorCity = 'Pyros';
          mothership = 'Infernova';
          break;
        case 'planet-x':
          temperature = '22°C';
          majorCity = 'Solara Nexus';
          inhabitants = 'The Xylons';
          mothership = 'The Seraphim';
          leader = 'Unknown Entity';
          weaponry = 'Elixir Repeater';
          population = 'Unknown';
          dayLength = '27 Hours';
          radius = '6,370 km';
          break;
        case 'lyra':
          temperature = '18°C';
          population = '2.8 Billion';
          dayLength = '32 Hours';
          radius = '5,980 km';
          majorCity = 'Aquatica';
          mothership = 'Wavecrest';
          break;
        case 'rath':
          temperature = '30°C';
          population = '3.7 Billion';
          dayLength = '28 Hours';
          radius = '7,120 km';
          majorCity = 'Canopia';
          mothership = 'Greenleaf';
          break;
        case 'aeronis':
          temperature = '-5°C';
          population = '2.1 Billion';
          dayLength = '36 Hours';
          radius = '5,980 km';
          majorCity = 'Stratos';
          mothership = 'Windborne';
          break;
        default:
          temperature = '25°C';
          majorCity = 'Capital City';
          inhabitants = 'Native Species';
          mothership = 'The Defender';
          leader = 'Commander';
          weaponry = 'Plasma Cannon';
          population = '2.5 Billion';
          dayLength = '30 Hours';
          radius = '6,500 km';
      }
    }
    
    // Update stat values
    const statValues = modal.querySelectorAll('.stat-value');
    if (statValues.length >= 6) {
      statValues[0].textContent = temperature;
      statValues[1].textContent = population;
      statValues[2].textContent = dayLength;
      statValues[3].textContent = radius;
      statValues[4].textContent = majorCity;
      statValues[5].textContent = mothership;
    }
    
    // Update key locations
    let locationsHTML = '';
    
    if (planetData && planetData.locations.length > 0) {
      // Create location items from the loaded data
      if (planetName.toLowerCase() === 'drakko' || 
          planetName.toLowerCase() === 'planet-x' || 
          planetName.toLowerCase() === 'lyra' ||
          planetName.toLowerCase() === 'aeronis' ||
          planetName.toLowerCase() === 'toppo' ||
          planetName.toLowerCase() === 'hestia' ||
          planetName.toLowerCase() === 'zepharo' ||
          planetName.toLowerCase() === 'rath' ||
          planetName.toLowerCase() === 'galeon' ||
          planetName.toLowerCase() === 'akaria' ||
          planetName.toLowerCase() === 'solara') {
        // Use images folder for all planets
        locationsHTML = planetData.locations.map((location, index) => {
          return `
            <div class="location-item">
              <div class="location-image">
                <img src="images/${planetName.toLowerCase()}-location-${index + 1}.png" alt="${location.name}">
              </div>
              <div class="location-content">
                <h4>${location.name.toUpperCase()}</h4>
                <p>${location.description}</p>
              </div>
            </div>
          `;
        }).join('');
      } else {
        // Standard case for other planets (now using same logic)
        locationsHTML = planetData.locations.map((location, index) => {
          return `
            <div class="location-item">
              <div class="location-image">
                <img src="images/${planetName.toLowerCase()}-location-${index + 1}.png" alt="${location.name}">
              </div>
              <div class="location-content">
                <h4>${location.name.toUpperCase()}</h4>
                <p>${location.description}</p>
              </div>
            </div>
          `;
        }).join('');
      }
    } else {
      // Fallback to existing code
      if (planetName.toLowerCase() === 'drakko') {
        locationsHTML = `
          <div class="location-item">
            <div class="location-image">
              <img src="images/drakko-location-1.png" alt="The Ashen Wastes">
            </div>
            <div class="location-content">
              <h4>THE ASHEN WASTES</h4>
              <p>A scorched desert of blackened rock and smoldering embers, where geysers of superheated steam erupt unpredictably. It is a hazard zone filled with random lava bursts, low visibility, and intense heat.</p>
            </div>
          </div>
          <div class="location-item">
            <div class="location-image">
              <img src="images/drakko-location-2.png" alt="The Molten Chasm">
            </div>
            <div class="location-content">
              <h4>THE MOLTEN CHASM</h4>
              <p>A bottomless fissure in the planet's crust, filled with surging lava tides that feed the world's unending infernos. It is believed to be the birthplace of Pyragoth and could serve as a crucial battleground or sacred site.</p>
            </div>
          </div>
          <div class="location-item">
            <div class="location-image">
              <img src="images/drakko-location-3.png" alt="The Crucible Peaks">
            </div>
            <div class="location-content">
              <h4>THE CRUCIBLE PEAKS</h4>
              <p>Jagged volcanic mountains constantly spewing fire. These peaks house the forges where Infernoid weapons and armor are crafted, functioning as both the industrial and strategic heart of the Infernoids' civilization.</p>
            </div>
          </div>
        `;
      } else if (planetName.toLowerCase() === 'planet-x') {
        locationsHTML = `
          <div class="location-item">
            <div class="location-image">
              <img src="images/planet-x-location-1.png" alt="Isle of Eternis">
            </div>
            <div class="location-content">
              <h4>ISLE OF ETERNIS</h4>
              <p>The Isle of Eternis is home to the Grand Temples, where Xylons meditate and refine the Elixir into its most potent forms. This sacred island is the heart of their spiritual and alchemical practices.</p>
            </div>
          </div>
          <div class="location-item">
            <div class="location-image">
              <img src="images/planet-x-location-2.png" alt="Isle of Aurelia">
            </div>
            <div class="location-content">
              <h4>ISLE OF AURELIA</h4>
              <p>The Isle of Aurelia contains vast crystalline mines glowing with veins of raw Elixir energy. These mines are not only a source of immense power but also the location of deep philosophical and scientific study into the nature of Elixir.</p>
            </div>
          </div>
          <div class="location-item">
            <div class="location-image">
              <img src="images/planet-x-location-3.png" alt="Isle of Navalis">
            </div>
            <div class="location-content">
              <h4>ISLE OF NAVALIS</h4>
              <p>The Isle of Navalis is a haven of tranquil waterfalls and luminescent flora, serving as a spiritual retreat where the Xylons can attune themselves to the flow of time and energy.</p>
            </div>
          </div>
        `;
      } else if (planetName.toLowerCase() === 'lyra') {
        locationsHTML = `
          <div class="location-item">
            <div class="location-image">
              <img src="images/lyra-location-1.png" alt="The Azure Depths">
            </div>
            <div class="location-content">
              <h4>THE AZURE DEPTHS</h4>
              <p>A vast underwater trench where bioluminescent creatures thrive in complete darkness. The Azure Depths are home to ancient mysteries and valuable resources that the Aquarans harvest with specialized submersibles.</p>
            </div>
          </div>
          <div class="location-item">
            <div class="location-image">
              <img src="images/lyra-location-2.png" alt="Coral Spires">
            </div>
            <div class="location-content">
              <h4>CORAL SPIRES</h4>
              <p>Massive coral formations that breach the ocean's surface, creating a natural archipelago. The Aquarans have built elaborate structures within and around these living towers, creating a stunning blend of natural and artificial architecture.</p>
            </div>
          </div>
          <div class="location-item">
            <div class="location-image">
              <img src="images/lyra-location-3.png" alt="The Tidal Forests">
            </div>
            <div class="location-content">
              <h4>THE TIDAL FORESTS</h4>
              <p>Expansive underwater kelp forests that sway with the planet's powerful currents. These forests serve as natural habitats for Lyra's diverse marine species and provide essential materials for Aquaran technology and medicine.</p>
            </div>
          </div>
        `;
      } else if (planetName.toLowerCase() === 'aeronis') {
        locationsHTML = `
          <div class="location-item">
            <div class="location-image">
              <img src="images/aeronis-location-1.png" alt="The Floating Isles">
            </div>
            <div class="location-content">
              <h4>THE FLOATING ISLES</h4>
              <p>A chain of massive landmasses that defy gravity, hovering miles above the planet's surface. Each isle houses unique ecosystems and serves as a natural testing ground for the Aether's most ambitious innovations in lightweight construction and anti-gravity propulsion.</p>
            </div>
          </div>
          <div class="location-item">
            <div class="location-image">
              <img src="images/aeronis-location-2.png" alt="The Cloudfall Canyons">
            </div>
            <div class="location-content">
              <h4>THE CLOUDFALL CANYONS</h4>
              <p>A vast network of deep ravines where dense, luminous clouds cascade like waterfalls. The unique atmospheric conditions create currents that the Aether harness for energy, while the canyon walls are lined with hanging gardens of specialized flora that thrive in the mist.</p>
            </div>
          </div>
          <div class="location-item">
            <div class="location-image">
              <img src="images/aeronis-location-3.png" alt="The Wind Spires">
            </div>
            <div class="location-content">
              <h4>THE WIND SPIRES</h4>
              <p>Towering natural rock formations that have been carved by constant gale-force winds into needle-like towers. The Aether have built intricate wind-channels throughout these spires, creating a natural symphony of sounds that serve as both artistic expression and a sophisticated planetary monitoring system.</p>
            </div>
          </div>
        `;
      } else if (planetName.toLowerCase() === 'toppo') {
        locationsHTML = `
          <div class="location-item">
            <div class="location-image">
              <img src="images/toppo-location-1.png" alt="The Quantum Fields">
            </div>
            <div class="location-content">
              <h4>THE QUANTUM FIELDS</h4>
              <p>Vast plains where reality itself seems to fluctuate, creating shimmering distortions visible to the naked eye. These unstable quantum zones are the primary source of the exotic particles that power Toppo's advanced technology. Research facilities dot the perimeter, studying the unpredictable quantum phenomena that occur spontaneously throughout the region.</p>
            </div>
          </div>
          <div class="location-item">
            <div class="location-image">
              <img src="images/toppo-location-2.png" alt="The Algorithmic Citadel">
            </div>
            <div class="location-content">
              <h4>THE ALGORITHMIC CITADEL</h4>
              <p>A massive geometric structure built of self-replicating nanomaterials that constantly reconfigure themselves according to complex mathematical patterns. The Citadel serves as both a repository of knowledge and a living computational entity that processes vast amounts of data gathered from across the known universe, searching for patterns and insights beyond the capabilities of individual cognition.</p>
            </div>
          </div>
          <div class="location-item">
            <div class="location-image">
              <img src="images/toppo-location-3.png" alt="The Resonance Caverns">
            </div>
            <div class="location-content">
              <h4>THE RESONANCE CAVERNS</h4>
              <p>A labyrinthine network of underground chambers where the planet's unique crystalline formations capture and amplify thought patterns. The Synthesists use these caverns as neural networking hubs, connecting their consciousness together in a collective computational matrix. The ambient hum of synchronous thought processes creates an eerie chorus that permeates the entire cave system.</p>
            </div>
          </div>
        `;
      } else if (planetName.toLowerCase() === 'hestia') {
        locationsHTML = `
          <div class="location-item">
            <div class="location-image">
              <img src="images/hestia-location-1.png" alt="The Eternal Flames">
            </div>
            <div class="location-content">
              <h4>THE ETERNAL FLAMES</h4>
              <p>A vast expanse of ever-burning fire fields that have remained alight for millennia. These sacred flames are said to be the first fire that ever burned in the universe, carefully tended by Hestia's fire priests. The heat is so intense that special heat-resistant suits must be worn by all but native Pyrolans. The flames shift between vibrant colors, each representing different emotional states of the planet itself.</p>
            </div>
          </div>
          <div class="location-item">
            <div class="location-image">
              <img src="images/hestia-location-2.png" alt="The Ashlands">
            </div>
            <div class="location-content">
              <h4>THE ASHLANDS</h4>
              <p>A desolate region where the remnants of ancient volcanic eruptions have created a landscape of gray and white ash dunes that stretch to the horizon. Despite its barren appearance, the mineral-rich ash supports a unique ecosystem of heat-loving organisms. Pyrolan nomads traverse these lands, harvesting rare minerals that can only form in the intense heat cycles of Hestia's surface.</p>
            </div>
          </div>
          <div class="location-item">
            <div class="location-image">
              <img src="images/hestia-location-3.png" alt="The Magma Forges">
            </div>
            <div class="location-content">
              <h4>THE MAGMA FORGES</h4>
              <p>A network of massive underground caverns where rivers of molten magma are channeled through elaborate systems of heat-resistant conduits. These natural forces power Hestia's most advanced technologies and are the birthplace of their legendary metallurgy. Pyrolan smiths craft weapons and artifacts of extraordinary resilience here, using techniques passed down through countless generations.</p>
            </div>
          </div>
        `;
      } else {
        locationsHTML = `
          <div class="location-item">
            <div class="location-image">
              <img src="images/${planetName.toLowerCase()}-location-1.png" alt="Primary Settlement">
            </div>
            <div class="location-content">
              <h4>Primary Settlement</h4>
              <p>The main population center and administrative hub of the planet.</p>
            </div>
          </div>
          <div class="location-item">
            <div class="location-image">
              <img src="images/${planetName.toLowerCase()}-location-2.png" alt="Resource Zone">
            </div>
            <div class="location-content">
              <h4>Resource Zone</h4>
              <p>An area rich with valuable minerals and resources unique to this world.</p>
            </div>
          </div>
          <div class="location-item">
            <div class="location-image">
              <img src="images/${planetName.toLowerCase()}-location-3.png" alt="Strategic Point">
            </div>
            <div class="location-content">
              <h4>Strategic Point</h4>
              <p>A location of significant tactical or cultural importance to the planet's inhabitants.</p>
            </div>
          </div>
        `;
      }
    }
    
    modal.querySelector('.location-list').innerHTML = locationsHTML;
    
    // Update major city section
    const cityName = modal.querySelector('.city-name');
    const cityDescription = modal.querySelector('.city-description');
    // Fallback: some markup uses a `.section-background` container instead of `.city-image`
    let cityImage = modal.querySelector('.city-image');
    if (!cityImage) {
      cityImage = modal.querySelector('.city-section .section-background');
    }
    
    if (cityName && cityDescription && cityImage) {
      cityName.textContent = majorCity.toUpperCase();
      
      if (planetData && planetData.majorCity.description) {
        cityDescription.textContent = planetData.majorCity.description;
      } else {
        cityDescription.textContent = this.getCityDescription(planetName);
      }
      
      // Clear any existing content
      cityImage.innerHTML = '';
      
      // Add loading container class
      cityImage.classList.add('image-container');
      
      // Create and add the optimized image element
      const img = this.createOptimizedImage(
        `images/${planetName.toLowerCase()}-major-city.png`,
        `${majorCity} city`,
        '100%',
        '100%'
      );
      cityImage.appendChild(img);
    }
    
    // Update mothership section
    const shipName = modal.querySelector('.ship-name');
    const shipDescription = modal.querySelector('.ship-description');
    const shipImage = modal.querySelector('.ship-image');
    
    if (shipName && shipDescription && shipImage) {
      shipName.textContent = mothership.toUpperCase();
      
      if (planetData && planetData.mothership.description) {
        shipDescription.textContent = planetData.mothership.description;
      } else {
        shipDescription.textContent = this.getShipDescription(planetName);
      }
      
      // Clear any existing content
      shipImage.innerHTML = '';
      
      // Add loading container class
      shipImage.classList.add('image-container');
      
      // Create and add the optimized image element
      const img = this.createOptimizedImage(
        `images/${planetName.toLowerCase()}-mothership.png`,
        `${mothership}`,
        '100%',
        '100%'
      );
      shipImage.appendChild(img);
    }
    
    // Update inhabitants section
    const inhabitantsName = modal.querySelector('.inhabitants-name');
    const inhabitantsDescription = modal.querySelector('.inhabitants-description');
    const leaderName = modal.querySelector('.leader-name');
    const leaderDescription = modal.querySelector('.leader-description');
    const inhabitantsImage = modal.querySelector('.inhabitants-image');
    
    if (inhabitantsName && inhabitantsDescription && leaderName && leaderDescription && inhabitantsImage) {
      // Set inhabitants information from loaded data
      if (planetData) {
        inhabitantsName.textContent = planetData.inhabitants.name.toUpperCase();
        inhabitantsDescription.textContent = planetData.inhabitants.description;
        leaderName.textContent = planetData.leader.name.toUpperCase();
        leaderDescription.textContent = planetData.leader.description;
      } else {
        // Fallback to existing code
        let inhabitants, leader;
        switch(planetName.toLowerCase()) {
          case 'drakko':
            inhabitants = 'THE INFERNOIDS';
            leader = 'PYRAGOTH THE UNDYING';
            break;
          case 'planet-x':
            inhabitants = 'THE XYLONS';
            leader = 'VAELITH THE ETERNAL';
            break;
          case 'lyra':
            inhabitants = 'THE AQUARANS';
            leader = 'HIGH TIDECALLER NERISSA';
            break;
          case 'rath':
            inhabitants = 'THE SYLVARI';
            leader = 'ELDER THORNE';
            break;
          case 'aeronis':
            inhabitants = 'THE AETHER';
            leader = 'SKY MARSHAL';
            break;
          default:
            inhabitants = 'NATIVE SPECIES';
            leader = 'COMMANDER';
        }
        
        inhabitantsName.textContent = inhabitants;
        inhabitantsDescription.textContent = this.getInhabitantsDescription(planetName);
        leaderName.textContent = leader;
        
        if (planetName.toLowerCase() === 'drakko') {
          leaderDescription.textContent = "A titan forged in the heart of a supervolcano. More fire than flesh, his body is a living furnace encased in obsidian armor. His core burns with an eternal flame, making him nearly unkillable—when destroyed, he regenerates from the embers.";
        } else if (planetName.toLowerCase() === 'planet-x') {
          leaderDescription.textContent = "Vaelith the Eternal is a transcendent being, a living conduit of Elixir energy who has reached a higher state of consciousness. Having absorbed and become one with Elixir, Vaelith has gained the ability to manipulate time itself, though his ability to foresee events has limitations. His form is ageless and ever-changing, glowing with Elixir light.";
        } else if (planetName.toLowerCase() === 'lyra') {
          leaderDescription.textContent = "High Tidecaller Nerissa possesses a profound psychic connection to Lyra's vast oceans, able to commune with and command marine life across the entire world. Her body is covered in bioluminescent patterns that shift with her emotions, and she can breathe both air and water with equal ease.";
        } else {
          leaderDescription.textContent = "The respected leader of the inhabitants, wielding both political and military power over their civilization.";
        }
      }
      
      // Clear any existing content
      inhabitantsImage.innerHTML = '';
      
      // Add loading container class
      inhabitantsImage.classList.add('image-container');
      
      // Create and add the optimized image element
      const img = this.createOptimizedImage(
        `images/${planetName.toLowerCase()}-inhabitants.png`,
        `${inhabitantsName.textContent}`,
        '100%',
        '100%'
      );
      inhabitantsImage.appendChild(img);
    }
    
    // Update weaponry section
    const weaponName = modal.querySelector('.weapon-name');
    const weaponDescription = modal.querySelector('.weapon-description');
    const weaponImage = modal.querySelector('.weapon-image');
    
    if (weaponName && weaponDescription && weaponImage) {
      if (planetData) {
        weaponName.textContent = planetData.weapon.name.toUpperCase();
        weaponDescription.textContent = planetData.weapon.description;
      } else {
        // Fallback to existing code
        let weaponry;
        switch(planetName.toLowerCase()) {
          case 'drakko':
            weaponry = 'MAGMA GAUNTLET';
            break;
          case 'planet-x':
            weaponry = 'ELIXIR REPEATER';
            break;
          case 'lyra':
            weaponry = 'HYDRO TRIDENT';
            break;
          case 'rath':
            weaponry = 'VITA STAFF';
            break;
          case 'aeronis':
            weaponry = 'STORM CONDUCTOR';
            break;
          default:
            weaponry = 'PLASMA CANNON';
        }
        
        weaponName.textContent = weaponry;
        weaponDescription.textContent = this.getWeaponDescription(planetName);
      }
      
      // Clear any existing content
      weaponImage.innerHTML = '';
      
      // Add loading container class
      weaponImage.classList.add('image-container');
      
      // Create and add the optimized image element
      const img = this.createOptimizedImage(
        `images/${planetName.toLowerCase()}-weapon.png`,
        weaponName.textContent,
        '100%',
        '100%'
      );
      weaponImage.appendChild(img);
    }
    
    // -----------------------------
    // Update "Next Planet" section
    // -----------------------------
    const nextPlanetNameEl = modal.querySelector('.next-planet-name');
    const nextPlanetImage = modal.querySelector('.next-planet-image');
    const exploreNextBtn  = modal.querySelector('.explore-next-planet-button');

    if (nextPlanetNameEl && nextPlanetImage && exploreNextBtn) {
      // Build an ordered list excluding Planet-12 (only discoverable via explorer)
      const planetOrder = this.planets
        .map(p => p.userData.name)
        .filter(name => name.toLowerCase() !== 'planet-12');

      // If current planet is not in the filtered list (i.e. it's Planet-12), hide this section
      if (!planetOrder.some(n => n.toLowerCase() === planetName.toLowerCase())) {
        modal.querySelector('.next-planet-section').style.display = 'none';
        return;
      }

      const currentIdx  = planetOrder.findIndex(n => n.toLowerCase() === planetName.toLowerCase());
      const nextIdx     = (currentIdx + 1) % planetOrder.length; // wrap-around among allowed planets
      const nextPlanetName = planetOrder[nextIdx];

      // Set display name
      nextPlanetNameEl.textContent = nextPlanetName.toUpperCase();

      // Preview rendering handled by createPlanetPreview

      // Reset existing listeners then add fresh one that opens the selected planet
      const clonedBtn = exploreNextBtn.cloneNode(true);
      exploreNextBtn.parentNode.replaceChild(clonedBtn, exploreNextBtn);

      clonedBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Clean up any planet-specific effects before swapping
        this.removeLocationImageEffects();
        this.removePlanetPreview();

        // Directly load the next planet while modal stays open
        this.showPlanetModal(nextPlanetName);
      });

      // Inject 3-D preview sphere instead of static image
      nextPlanetImage.innerHTML = '';
      this.createPlanetPreview(nextPlanetImage, nextPlanetName);
    }
    
    // Show modal
    modal.classList.add('visible');
    
    // Always jump back to top instantly (no smooth animation)
    const modalContentEl = modal.querySelector('.modal-content');
    if (modalContentEl) {
      modalContentEl.style.setProperty('scroll-behavior','auto','important');
      modalContentEl.scrollTop = 0;
      modalContentEl.style.removeProperty('scroll-behavior');
    }
    const locScroller = modal.querySelector('.locations-section .section-content');
    if (locScroller) locScroller.scrollLeft = 0;
    
    // Disable controls while modal is open
    this.controls.enabled = false;
    
    // Add close button handler
    const closeButton = modal.querySelector('.close-modal');
    if (closeButton) {
      // Remove any existing listener
      const newButton = closeButton.cloneNode(true);
      closeButton.parentNode.replaceChild(newButton, closeButton);
      
      // Add new click listener
      newButton.addEventListener('click', () => {
        this.hideModal();
      });
    }
    
    // Setup pagination
    this.setupModalPagination(modal);
    
    this.modalContent = modal.querySelector('.modal-content');
    this.locationsSection = modal.querySelector('.locations-section');
    if (this.locationsSection) {
      this.locationsScroller = this.locationsSection.querySelector('.section-content');
    }
    console.log('showPlanetModal: Element References:', {
        modalContent: !!this.modalContent,
        locationsSection: !!this.locationsSection,
        locationsScroller: !!this.locationsScroller
    }); // <-- Add ); here

    // *** Setup location arrow scrolling ***
    this.setupLocationArrows();

    // Setup parallax + motion-blur effects on location images
    this.setupLocationImageEffects(modal);

    // Record explored planet and update progress UI
    if (!this.exploredPlanets.has(planetName)) {
      this.exploredPlanets.add(planetName);
      this.updateExploreProgress();
    }

    // Reveal top gradient overlay
    const grad = document.querySelector('.top-gradient');
    if (grad) grad.style.display = 'block';

    /* ---------------- Section title reveal on scroll ---------------- */
    // Observer to apply textReveal when titles enter viewport
    if (this._sectionTitleObserver) {
      this._sectionTitleObserver.disconnect();
    }
    const contentEl = modal.querySelector('.modal-content');
    if (contentEl) {
      // Ensure all titles start hidden to prevent flicker before reveal
      contentEl.querySelectorAll('.section-title').forEach(el => {
        el.style.opacity = '0';
        el.removeAttribute('data-revealed');
      });

       const opts = { root: contentEl, rootMargin: '0px', threshold: 0.1 };
      this._sectionTitleObserver = new IntersectionObserver((entries) => {
        entries.forEach(ent => {
          if (ent.isIntersecting) {
            const titleEl = ent.target;
            if (!titleEl.dataset.revealed) {
              // Keep hidden while we prepare the animation
              titleEl.style.opacity = '0';

              // Perform text-reveal animation
              this.applyTextReveal(titleEl, titleEl.textContent.trim());

              // Flag as revealed and show right after DOM update
              requestAnimationFrame(() => {
                titleEl.setAttribute('data-revealed', 'true');
                titleEl.style.opacity = '1';
              });

              // Stop observing once revealed
              this._sectionTitleObserver.unobserve(titleEl);
            }
          }
        });
      }, opts);
      modal.querySelectorAll('.section-title').forEach(el => {
        el.removeAttribute('data-revealed'); // reset
        this._sectionTitleObserver.observe(el);
      });
    }

    // Update top tagline
    const planetIdx = this.planets.findIndex(p => p.userData.name.toLowerCase() === planetName.toLowerCase());
    const tagDisplayIdx = planetIdx >= 0 ? String(planetIdx + 1).padStart(2, '0') : '';
    const taglineEl = document.getElementById('scene-tagline');
    if (taglineEl) {
      this.scrambleText(taglineEl, `${planetName.toUpperCase()} // ${tagDisplayIdx}`);
    }

    // ... existing code ...
      modal.style.scrollBehavior = 'smooth';
    

    // Call to setup tagline rotation after modal is shown and content is populated
    if (window.setupTaglineRotation) {
      requestAnimationFrame(() => {
        window.setupTaglineRotation();
      });
    }
  }

  async loadPlanetData(planetName) {
    try {
      const response = await fetch(`text/${planetName.toLowerCase()}-text.txt`);
      if (!response.ok) {
        console.error(`Failed to load data for ${planetName}`);
        return null;
      }
      
      const text = await response.text();
      const data = this.parsePlanetText(text, planetName);
      return data;
    } catch (error) {
      console.error(`Error loading planet data for ${planetName}:`, error);
      return null;
    }
  }
  
  /* ---------------------------------------------
     Parallax & Motion-Blur Effects for Location Images
  --------------------------------------------- */
  setupLocationImageEffects(modal) {
    const modalContent = modal.querySelector('.modal-content');
    const locationsContainer = modal.querySelector('.locations-section .section-content');
    // Exclude the rotating planet tagline from the parallax list so its custom transform is not overwritten
    const parallaxImages = Array.from(modal.querySelectorAll('.modal-section img'))
      // Exclude rotating tagline and insignia images so their transforms are handled elsewhere or stay static
      .filter(img => !img.classList.contains('planet-tagline') &&
                    !img.classList.contains('planet-insignia') &&
                    !img.classList.contains('planet-insignia-large'));

    if (parallaxImages.length === 0) return;

    // Helper to compute and apply both vertical and horizontal parallax
    const updateTransforms = () => {
      parallaxImages.forEach(img => {
        let translateY = 0;
        let translateX = 0;

        // Vertical parallax (relative to modal vertical scroll)
        if (modalContent) {
          const viewportHeight = modalContent.clientHeight;
          const rect = img.getBoundingClientRect();
          const offsetY = (rect.top + rect.height / 2) - (viewportHeight / 2);
          translateY = Math.round(offsetY * -0.15); // Round to nearest pixel
        }

        // Horizontal parallax – only for images inside the locations section.
        if (locationsContainer && img.closest('.locations-section')) {
          const scrollLeft = locationsContainer.scrollLeft;
          translateX = Math.round(scrollLeft * 0.03); // Round to nearest pixel
        }

        img.style.transform = `translate3d(${translateX}px, ${translateY}px, 0)`;
      });
    };

    // Event handlers
    const verticalScrollHandler = () => updateTransforms();
    const horizontalScrollHandler = () => updateTransforms();

    // Initial calculation
    updateTransforms();

    // Attach listeners
    if (modalContent) modalContent.addEventListener('scroll', verticalScrollHandler);
    if (locationsContainer) locationsContainer.addEventListener('scroll', horizontalScrollHandler);
    window.addEventListener('resize', updateTransforms);

    // Cleanup when modal closes
    this._cleanupLocationEffects = () => {
      if (modalContent) modalContent.removeEventListener('scroll', verticalScrollHandler);
      if (locationsContainer) locationsContainer.removeEventListener('scroll', horizontalScrollHandler);
      window.removeEventListener('resize', updateTransforms);
      parallaxImages.forEach(img => {
        img.style.transform = '';
      });
    };
  }

  removeLocationImageEffects() {
    if (this._cleanupLocationEffects) {
      this._cleanupLocationEffects();
      this._cleanupLocationEffects = null;
    }
  }
  
  setupModalPagination(modal) {
    // Get all modal sections and pagination dots
    const sections = Array.from(modal.querySelectorAll('.modal-section'));
    const paginationDots = Array.from(modal.querySelectorAll('.pagination-dot'));
    const modalContent = modal.querySelector('.modal-content');
    
    // Ensure first section (insignia section) is active
    sections.forEach((section, index) => {
      if (index === 0) {
        section.classList.add('section-visible');
      } else {
        section.classList.remove('section-visible');
      }
    });
    
    // Ensure first dot is active
    paginationDots.forEach((dot, index) => {
      if (index === 0) {
        dot.classList.add('active');
      } else {
        dot.classList.remove('active');
      }
    });
    
    // Clear any existing listeners on dots
    paginationDots.forEach((dot, index) => {
      const newDot = dot.cloneNode(true);
      dot.parentNode.replaceChild(newDot, dot);
      paginationDots[index] = newDot;
      
      // Add click listener to scroll to corresponding section
      newDot.addEventListener('click', () => {
        if (sections[index]) {
          sections[index].scrollIntoView({ behavior: 'smooth' });
          
          // Update active state on all dots
          paginationDots.forEach((d, i) => {
            d.classList.toggle('active', i === index);
          });
        }
      });
    });
    
    // Create intersection observer to detect which section is most visible
    const observerOptions = {
      root: modalContent,
      rootMargin: '0px',
      threshold: 0.5 // Consider a section visible when 50% is in view
    };
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Get the index of the visible section
          const visibleIndex = sections.indexOf(entry.target);
          
          // Update the active state of dots
          paginationDots.forEach((dot, index) => {
            dot.classList.toggle('active', index === visibleIndex);
          });
          
          // Add 'section-visible' class for animations
          entry.target.classList.add('section-visible');

          // If hero-section comes into view, trigger name reveal again
          if (entry.target.classList.contains('hero-section')) {
            const heroNameEl = entry.target.querySelector('.planet-name');
            if (heroNameEl) {
              // Use dataset to ensure we only trigger once per visibility cycle
              if (!heroNameEl.dataset.revealed) {
                this.applyTextReveal(heroNameEl, heroNameEl.textContent.trim());
                heroNameEl.dataset.revealed = 'true';
              }
            }
          }
        } else {
          // Remove the class when section is not visible
          entry.target.classList.remove('section-visible');
        }
      });
    }, observerOptions);
    
    // Observe all sections
    sections.forEach(section => {
      observer.observe(section);
    });
    
    // Fallback scroll event for better responsiveness
    modalContent.addEventListener('scroll', () => {
      // Get the current scroll position
      const scrollPosition = modalContent.scrollTop;
      const viewportHeight = modalContent.clientHeight;
      
      // Find the section that takes up most of the viewport
      let activeIndex = 0;
      let bestVisibility = 0;
      
      sections.forEach((section, index) => {
        const rect = section.getBoundingClientRect();
        const sectionTop = rect.top;
        const sectionHeight = rect.height;
        
        // Calculate visibility percentage
        const visibleTop = Math.max(0, sectionTop);
        const visibleBottom = Math.min(viewportHeight, sectionTop + sectionHeight);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        const visibilityPercent = visibleHeight / viewportHeight;
        
        if (visibilityPercent > bestVisibility) {
          bestVisibility = visibilityPercent;
          activeIndex = index;
        }
        
        // Add animation class when section is at least 30% visible
        if (visibilityPercent > 0.3) {
          section.classList.add('section-visible');
        } else {
          section.classList.remove('section-visible');
        }
      });
      
      // Update the active state of dots
      paginationDots.forEach((dot, index) => {
        dot.classList.toggle('active', index === activeIndex);
      });
    });
    
    // Initialize with the first dot active and first section visible
    paginationDots[0].classList.add('active');
    sections[0].classList.add('section-visible');
    
    /* ---------- Page Counter + Arrows UI (bottom-right) ---------- */
    // Remove existing if any (e.g., when reopening modal)
    modal.querySelector('.modal-page-controls')?.remove();

    const pageControls = document.createElement('div');
    pageControls.className = 'modal-page-controls';

    // Counter square
    const counterDiv = document.createElement('div');
    counterDiv.className = 'page-counter';
    const spanCurrent = document.createElement('span');
    spanCurrent.className = 'counter-current';
    const spanTotal = document.createElement('span');
    spanTotal.className = 'counter-total';
    counterDiv.appendChild(spanCurrent);
    counterDiv.appendChild(spanTotal);

    // Arrow stack
    const arrowStack = document.createElement('div');
    arrowStack.className = 'page-arrows';
    const btnUp = document.createElement('button');
    btnUp.className = 'page-arrow up';
    btnUp.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M12 10 L8 4 L4 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    const btnDown = document.createElement('button');
    btnDown.className = 'page-arrow down';
    btnDown.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M4 6 L8 12 L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    arrowStack.appendChild(btnUp);
    arrowStack.appendChild(btnDown);

    pageControls.appendChild(counterDiv);
    pageControls.appendChild(arrowStack);
    modal.appendChild(pageControls);

    const pad2 = (n)=>String(n+1).padStart(2,'0');
    const totalStr = `/${String(sections.length).padStart(2,'0')}`;
    spanTotal.textContent = totalStr;

    const setCounter=(idx)=>{
      spanCurrent.textContent = pad2(idx);
      btnUp.disabled = (idx===0);
      btnDown.disabled = (idx===sections.length-1);
    };
    setCounter(0);

    btnUp.addEventListener('click',()=>{
      const currentIdx = paginationDots.findIndex(d=>d.classList.contains('active'));
      const target = Math.max(0,currentIdx-1);
      sections[target].scrollIntoView({behavior:'smooth'});
    });
    btnDown.addEventListener('click',()=>{
      const currentIdx = paginationDots.findIndex(d=>d.classList.contains('active'));
      const target = Math.min(sections.length-1,currentIdx+1);
      sections[target].scrollIntoView({behavior:'smooth'});
    });

    // update counter when section visibility changes
    const counterObserver = new IntersectionObserver((ents)=>{
      ents.forEach(e=>{
        if(e.isIntersecting){
          const idx = sections.indexOf(e.target);
          setCounter(idx);
        }
      });
    },observerOptions);
    sections.forEach(sec=>counterObserver.observe(sec));
    
    // Return cleanup function to remove observer
    return () => {
      sections.forEach(section => {
        observer.unobserve(section);
      });
    };
  }
  
  getCityDescription(planetName) {
    switch(planetName.toLowerCase()) {
      case 'drakko':
        return "Pyros sprawls across a vast volcanic caldera, with buildings carved from cooled magma and streets glowing with rivers of lava. The central palace stands at the highest point, surrounded by industrial forges constantly belching smoke and flame.";
      case 'planet-x':
        return "Solara Nexus is a gleaming city of intricate crystalline structures that filter and amplify the Elixir's energy. The architecture is designed to channel the flow of Elixir throughout the city, creating a network of luminous pathways that serve both as transportation and as energy distribution.";
      case 'lyra':
        return "Aquatica is a marvel of aquatic engineering, built within a massive air dome at the ocean floor. The city features transparent walls that offer panoramic views of the surrounding sea life, with buildings that incorporate living coral and bio-luminescent organisms. Water flows freely through channels throughout the city, powering its infrastructure and providing transportation.";
      case 'aeronis':
        return "Stratos is a breathtaking metropolis suspended among the clouds, consisting of multiple interconnected platforms that float at different altitudes. The city's buildings are constructed from lightweight, nearly transparent materials that shift with air currents while maintaining structural integrity. Vertical wind tunnels serve as natural elevators between levels, and residents travel via personal gliders or atmospheric transports that harness the ever-present winds.";
      case 'toppo':
        return "Nexus Prime is the pulsing heart of Toppo's technological advancement, a city that exists as much in digital space as physical reality. Its crystalline towers house billions of interconnected neural networks, with holographic interfaces shimmering across every surface. The city constantly reconfigures itself to optimize efficiency, with buildings that shift and transform based on population density and computational needs. Light-based transportation systems instantly move citizens through quantum tunnels that bypass conventional space-time.";
      case 'hestia':
        return "Ignis Dominion is built within the caldera of an active supervolcano, with architecture that harnesses and channels the immense heat rather than resisting it. Buildings are constructed from obsidian and other volcanic materials, designed to flex rather than break during frequent tremors. The city exists on multiple levels, with the ruling Fire Council chambers suspended directly above the magma lake at the center. Lava channels course through the streets like canals, providing energy and heat to all sectors of the metropolis. The air shimmers with heat distortion, creating a dreamlike quality to the cityscape.";
      case 'zepharo':
        return "Verdantis is a magnificent city built into and around a cluster of giant, ancient trees. The buildings are a harmonious blend of grown and crafted structures, with spiraling towers that seem to sprout from the massive trunks. Bridges of woven vines connect different levels, and the entire city is illuminated by bioluminescent plants that respond to the needs and movements of the inhabitants.";
      case 'rath':
        return "Canopia sprawls across a vast jungle canopy, with structures built both atop and within massive trees. The architecture mimics natural forms, with buildings that appear to have grown rather than been constructed. Living bridges connect different districts, and giant leaves serve as roofs and walls. The city is in constant, subtle motion as the trees sway with the winds.";
      case 'galeon':
        return "Crystallis is a geometric marvel built from perfectly angled mineral formations. The city catches and refracts light in spectacular prismatic displays, creating ever-changing patterns across its surfaces. Buildings rise in perfect mathematical harmony, interconnected by bridges that appear to float in midair. The central citadel is carved from a single massive crystal and serves as both government center and energy conduit for the entire civilization.";
      case 'akaria':
        return "Lumina is a city of pure light and energy, with structures composed of solidified photons contained within gravitational fields. The buildings shift and flow like liquid, adapting to the needs of inhabitants. Streets are unnecessary as residents simply teleport between locations through light corridors. The entire city pulses with a rhythmic glow that synchronizes with the collective consciousness of its inhabitants.";
      case 'solara':
        return "Nova Prime is a metropolis of pure light and energy, with buildings constructed from solidified sunlight. The city is arranged in concentric rings around a central tower that captures and amplifies solar radiation. The architecture is fluid and dynamic, with structures that shift to maximize light absorption throughout the day. Golden spires rise above plazas filled with luminous fountains, creating a cityscape that is both dazzling and harmonious.";
      default:
        return "The major city of this planet, home to the central government and serving as the cultural hub for its inhabitants.";
    }
  }
  
  getShipDescription(planetName) {
    switch(planetName.toLowerCase()) {
      case 'drakko':
        return "A colossal vessel powered by a captured star's core, Infernova's hull gleams like obsidian and is forged from heat-resistant minerals. The ship literally burns through space, leaving a trail of fire in its wake, and its appearance in orbit over a planet casts a second sun in the sky.";
      case 'planet-x':
        return "The Seraphim is a ethereal vessel that seems to phase between dimensions. Built from crystalline materials and powered by refined Elixir, it doesn't so much fly as drift through the fabric of space-time. The ship appears as a brilliant, faceted prism that refracts light in impossible ways.";
      case 'lyra':
        return "Wavecrest is an extraordinary vessel that contains a massive interior ocean. The ship's systems are powered by tidal forces generated within this contained sea, and its outer hull mimics water's fluid properties, allowing it to flow around obstacles and absorb impacts. The ship can generate massive tidal waves in space that carry it forward at tremendous speeds.";
      case 'aeronis':
        return "Windborne is unlike any conventional vessel, appearing as a vast, ever-shifting cloud formation wrapped around a lightweight skeletal frame. The ship contains its own atmospheric systems and wind currents, allowing it to generate lift in any environment. Its translucent membranes can expand to capture solar energy or contract for faster-than-light travel, and the ship can divide into smaller autonomous vessels that reconnect when needed.";
      case 'toppo':
        return "Synaptic Voyager exists in a quantum superposition, simultaneously physical and digital. Its modular design consists of trillions of nanites that can reconfigure into any shape needed for a given mission. The core of the ship is a massive quantum computer whose computational power rivals entire planetary networks. Unlike traditional vessels, the Synaptic Voyager doesn't merely transport Synthesists physically—it can upload and download their consciousness between distant terminals across the galaxy, allowing instantaneous 'travel' without physical displacement.";
      case 'hestia':
        return "Pyrosphere is a marvel of thermal engineering, resembling a miniature sun when viewed from a distance. The spherical vessel's outer hull is composed of overlapping plates of a unique metal alloy that absorbs and redistributes heat with perfect efficiency. At its core burns an artificial star, contained within multiple layers of force fields and heat sinks. The ship doesn't use conventional engines—instead, it propels itself by precisely controlled thermal eruptions, essentially 'surfing' on waves of its own generated heat. The interior chambers maintain different temperature zones, from relatively cool areas for visitors to near-plasma conditions where the Pyrolans are most comfortable.";
      case 'zepharo':
        return "Gaia's Embrace appears to be a living entity rather than a constructed vessel. Its hull is composed of sentient plant matter that grows, heals, and adapts to different environments. The ship is powered by bioelectric energy generated by the symbiotic relationship between the vessel and its crew. Interior spaces feature natural ecosystems that provide oxygen, food, and materials for the inhabitants.";
      case 'rath':
        return "Greenleaf is a marvel of bio-organic engineering, resembling a massive floating leaf structure. The ship's hull is composed of living plant tissue that can repair itself when damaged. Its propulsion system harnesses the natural energy flows from the sun and cosmic radiation, converting them into thrust through specialized photosynthetic processes. The interior contains multiple biomes that sustain diverse ecosystems, providing both resources and a connection to nature for its crew.";
      case 'galeon':
        return "The Prism Voyager is an architectural masterpiece composed of interlocking geometric crystals that can reconfigure based on need. The ship harnesses and amplifies cosmic energy through its crystalline structure, allowing it to travel through space using minimal power. The vessel's interior spaces are defined by mathematical precision, with rooms that expand or contract according to golden ratio formulas.";
      case 'akaria':
        return "Luminaris is a vessel composed entirely of controlled energy fields rather than physical matter. The ship can transform between solid and energy states at will, allowing it to pass through obstacles or defensive shields with ease. It travels by folding space-time around itself, effectively teleporting across vast distances. The Luminaris doesn't contain traditional rooms or corridors – instead, crew members exist within personalized energy matrices that provide all necessities.";
      case 'solara':
        return "Solar Sovereign is a majestic vessel powered entirely by captured stellar energy. Its golden hull is composed of photon-harvesting materials that can absorb and store energy from any star it encounters. The ship's core contains a miniature artificial sun that provides near-infinite power. When traveling through space, it leaves a trail of golden light that persists for hours, and when entering a planetary system, it appears as a second sun to observers.";
      default:
        return "The flagship of this planet's fleet, an impressive vessel that serves as both a military asset and a symbol of their technological advancement.";
    }
  }
  
  getInhabitantsDescription(planetName) {
    switch(planetName.toLowerCase()) {
      case 'drakko':
        return "Humanoid beings whose skin has the texture and appearance of cooling lava, with magma flowing through their veins. Their eyes glow like hot coals, and they emit constant heat. They are impervious to extremes of temperature and can manipulate fire and heat, utilizing their planet's environment to their advantage.";
      case 'planet-x':
        return "The Xylons evolved alongside the mysterious Elixir, becoming symbiotic with its energy. Their translucent bodies pulse with vibrant internal light, and they possess complete control over their molecular structure, allowing them to change form at will. Sustained by the planet's ambient Elixir energy, they are far more energy than matter.";
      case 'lyra':
        return "The Aquarans are an amphibious species with streamlined bodies, webbed extremities, and skin that shifts between blues and greens. Their bodies contain specialized organs that extract oxygen from both air and water, and bioluminescent patterns on their skin serve as a form of communication and emotional expression. They possess natural psychic abilities that allow them to communicate with and sometimes control Lyra's marine life.";
      case 'aeronis':
        return "The Aether are light-bodied humanoids with hollow bones and slightly translucent skin that reveals swirling air currents within. Their bodies naturally produce specialized gases that allow them to adjust their buoyancy and float for limited periods. They possess heightened senses attuned to atmospheric conditions and can communicate across vast distances by manipulating sound waves. The Aether's lungs are remarkably adapted to thin air, and they require only a fraction of the oxygen needed by other species.";
      case 'toppo':
        return "The Synthesists began as organic humanoids but have progressively merged with their technology over generations. Their bodies now blend biological tissue with quantum circuitry, and neural implants allow direct mental interfaces with Toppo's vast computational networks. Many Synthesists have abandoned physical form entirely, existing as pure consciousness within digital substrates. Those who maintain bodies have evolved enlarged craniums to house enhanced neural structures, with skin that contains photosensitive receptors capable of absorbing and processing information directly from light patterns. Their society functions as a hive mind connected by quantum entanglement, allowing instantaneous sharing of knowledge while maintaining individual autonomy.";
      case 'hestia':
        return "The Pyrolans evolved in Hestia's extreme heat conditions, developing bodies capable of withstanding temperatures that would instantly incinerate most species. Their skin has a glossy, almost metallic appearance, with intricate patterns of glowing veins that shift in color based on their emotional state. Instead of breathing oxygen, they process sulfur compounds abundant in Hestia's atmosphere, exhaling colorful plumes of gas. The most remarkable feature of the Pyrolans is their biological ability to control thermal energy—they can increase the temperature of objects through touch, generate flames from their fingertips, and sense thermal variations with incredible precision. Their society places high value on controlled passion and creative expression, with fire-dancing and heat-sculpting being their most celebrated art forms.";
      case 'zepharo':
        return "The Florians are a plantoid species with humanoid characteristics. Their skin resembles bark or leaves, changing color with the seasons, and they photosynthesize in addition to consuming nutrients. Small flowers bloom across their bodies when experiencing strong emotions, and they communicate partially through the release of aromatic compounds. Florians share a collective consciousness with the plant life of their world and can manipulate growth patterns through touch.";
      case 'rath':
        return "The Sylvari are a highly adaptable species with a symbiotic relationship to plant life. Their bodies feature leafy growths and bark-like skin that changes with the seasons. They possess chlorophyll in their blood, allowing them to derive energy from sunlight while still consuming nutrients. Sylvari can communicate telepathically with plants and manipulate their growth with touch. Their society is organized around seasonal cycles and the natural progression of growth and renewal.";
      case 'galeon':
        return "The Geometrae have bodies composed of crystalline structures arranged in perfect mathematical patterns. Their skin refracts light, creating prismatic displays that reflect their emotions and thoughts. They don't require traditional sustenance, instead absorbing and processing energy directly from cosmic radiation. Geometrae communicate through precisely modulated light patterns and can manipulate crystalline materials with their minds. Their society values precision, harmony, and mathematical beauty above all else.";
      case 'akaria':
        return "The Lumina exist in a state between physical matter and pure energy. Their bodies appear humanoid but radiate a constant glow, with features that shift and blur at the edges. They don't require food or water, instead absorbing ambient energy from their surroundings. Lumina can manipulate light and energy at will, creating solid constructs from pure photons or becoming intangible to pass through physical barriers. They communicate through complex light patterns and telepathic resonance.";
      case 'solara':
        return "The Solarians are a species of photosynthetic humanoids whose golden skin naturally captures and processes sunlight. Their bodies glow with varying intensities depending on their energy levels, and their hair resembles rays of sunlight that float and wave regardless of gravity or wind conditions. Solarians can survive without food by basking in sunlight for extended periods, and they possess the ability to emit controlled bursts of solar energy from their hands. Their society is structured around the principle of 'Radiant Harmony' - the belief that all life should share energy freely as the sun shares its light.";
      default:
        return "The dominant species of this world, possessing a unique culture and physiology adapted to their planetary environment.";
    }
  }
  
  getWeaponDescription(planetName) {
    switch(planetName.toLowerCase()) {
      case 'drakko':
        return "A devastating weapon worn on the forearm, the Magma Gauntlet can fire superheated slag that melts through virtually any material. It can also be used in melee combat, turning the user's fist into a molten hammer capable of shattering stone and metal alike.";
      case 'planet-x':
        return "This elegant weapon channels refined Elixir into rapid-fire bursts of crystallized temporal energy. When struck, targets experience localized time distortions, causing them to slow down or accelerate unpredictably. The repeater draws power directly from the user's connection to Elixir, effectively giving Xylons unlimited ammunition.";
      case 'lyra':
        return "This advanced three-pronged spear channels Lyra's hydrodynamic technology into a versatile weapon. It can project powerful jets of pressurized water capable of cutting through steel, create defensive water shields, or generate localized whirlpools to trap enemies. In close combat, it conducts bio-electrical energy that can stun opponents with a mere touch.";
      case 'aeronis':
        return "The Storm Conductor is a staff-like device capable of manipulating atmospheric conditions with extraordinary precision. It can compress air into devastating concussive blasts, create localized cyclones to trap enemies, or generate lightning strikes from even the clearest skies. In the hands of a skilled Aether operator, it can also be used to control wind currents for flight assistance, create sound-dampening zones for stealth, or even modify local weather patterns to provide tactical advantages.";
      case 'toppo':
        return "The Quantum Disruptor doesn't physically exist until activated—it materializes directly from the wielder's neural interface as a sleek handheld device that defies conventional physics. The weapon emits targeted quantum fields that can destabilize matter at the subatomic level, causing objects to phase between states or collapse entirely. Advanced versions can create localized reality distortions, temporarily altering fundamental physical laws within a defined area. The weapon requires no ammunition, drawing power directly from the quantum fluctuations of the multiverse itself. In the hands of master Synthesists, it can even be used to create small, controlled pocket dimensions for temporary imprisonment of threats.";
      case 'hestia':
        return "The Thermal Lance resembles a curved scepter made of heat-resistant metal alloys and volcanic glass, expertly forged in the heart of Hestia's magma forges. In the hands of a Pyrolan warrior, it can focus and project intense heat with surgical precision, creating beams of energy that can cut through virtually any material or ignite targets from a distance. More advanced models can manipulate thermal energy in more sophisticated ways—absorbing and redirecting heat, creating temperature barriers, or even inducing localized fusion reactions for devastating explosive effects. The Lance responds to the wielder's biochemistry, making it nearly impossible for non-Pyrolans to use effectively. Most remarkably, these weapons can absorb ambient heat from surroundings, allowing them to function with increased power in already hot environments while simultaneously cooling the immediate area around the user—a tactical advantage that lets Pyrolans operate in environments that would normally be too extreme even for them.";
      case 'zepharo':
        return "The Seed Launcher is a living weapon that grows from the arm of the wielder, forming a symbiotic connection. It fires specialized seed pods that can rapidly grow into entangling vines, explosive spore clusters, or defensive barriers. The weapon adapts to its user over time, developing unique abilities based on their fighting style and needs. When not in use, it retracts into a small vine bracelet worn by the user.";
      case 'rath':
        return "The Vita Staff is a marvel of bio-organic engineering, grown rather than manufactured from the sacred Life Trees of Rath. Each staff contains a living core that bonds with its wielder, responding to their thoughts and energy. The weapon can channel and amplify the natural life force of its surroundings, allowing users to accelerate plant growth, heal organic matter, or weaponize life energy as concentrated bursts. Master wielders can even temporarily animate plant matter to create guardians or barriers.";
      case 'galeon':
        return "The Crystal Matrix is a mathematically perfect weapon composed of interlocking geometric crystals that hover around the wielder's arm. The crystals can reconfigure instantly into different forms—a shield, a blade, a ranged weapon—based on the user's thoughts. The weapon amplifies and focuses cosmic energy through its precisely aligned crystal structure, creating beams of concentrated force. The Matrix can also create holographic duplicates of itself to confuse enemies.";
      case 'akaria':
        return "The Photon Weaver appears as an intricate bracelet of pure light that spirals around the wielder's arm. It can extend into various weapons—whips, blades, shields—formed from hardened light constructs. The weapon draws power directly from the wielder's connection to the energy spectrum, meaning it never needs recharging but varies in strength based on the user's mental state. Advanced users can create semi-autonomous light constructs that act independently while remaining connected to the Weaver.";
      case 'solara':
        return "The Solar Lance is an elegant staff-like weapon that harnesses and focuses the abundant solar energy of Solara. In the hands of a skilled Solarian warrior, it can project beams of concentrated sunlight capable of melting through most materials or create shields of solid light for defense. The weapon doesn't require ammunition, drawing power directly from ambient light or from the wielder's own energy reserves. Advanced versions can manipulate light in more sophisticated ways - creating illusions, bending light around the user for temporary invisibility, or even temporarily blinding opponents with controlled solar flares.";
      default:
        return "The signature weapon of this civilization, demonstrating their technological capabilities and adapted to their unique physiology and environmental conditions.";
    }
  }
  
  hideModal() {
    // First clean parallax/blur listeners
    this.removeLocationImageEffects();
    // Dispose planet preview renderer
    this.removePlanetPreview();

    const modal = document.getElementById('planet-modal');
    if (modal && modal.classList.contains('visible')) {
      // Add closing class to trigger reverse animation
      modal.classList.add('closing');

      // Wait for animation to finish then fully hide
      setTimeout(() => {
      modal.classList.remove('visible');
        modal.classList.remove('closing');
        // Hide gradient overlay once modal closed
        const grad = document.querySelector('.top-gradient');
        if (grad) grad.style.display = 'none';
      }, 600); // duration of stellarZoomReverse

      // Re-enable controls immediately
      this.controls.enabled = true;
    }

    // Disconnect title observer
    if (this._sectionTitleObserver) {
      this._sectionTitleObserver.disconnect();
      this._sectionTitleObserver = null;
    }
  }
  
  hidePlanetInfo() {
    // Hide minimal info panel
    const planetInfo = document.getElementById('planet-info-main');
    if (planetInfo) planetInfo.classList.remove('visible');
    
    // Revert tagline to default
    const taglineEl = document.getElementById('scene-tagline');
    if (taglineEl) {
      this.scrambleText(taglineEl, 'EXPLORE THE UNIVERSE');
    }
    
    // Remove corona effect - THIS LINE SHOULD HAVE BEEN REMOVED
    // this.removeCorona(); // <<< Ensure this line is deleted
    
    // Hide modal if it's open
    this.hideModal();
  }
  
  updatePlanetStats(planetName) {
    // Planet-specific stats
    let temperature, majorCity, inhabitants, mothership, leader, weaponry;
    let population, dayLength, radius;
    
    switch(planetName.toLowerCase()) {
      case 'drakko':
        temperature = '857°C';
        majorCity = 'Pyros';
        inhabitants = 'The Infernoids';
        mothership = 'Infernova';
        leader = 'Pyragoth';
        weaponry = 'Magma Gauntlet';
        population = '3.5 Billion';
        dayLength = '32 Hours';
        radius = '5,270 km';
        break;
      case 'planet-x':
        temperature = '22°C';
        majorCity = 'Solara Nexus';
        inhabitants = 'The Xylons';
        mothership = 'The Seraphim';
        leader = 'Unknown Entity';
        weaponry = 'Elixir Repeater';
        population = 'Unknown';
        dayLength = '27 Hours';
        radius = '6,370 km';
        break;
      case 'toppo':
        temperature = '15°C';
        majorCity = 'Nexus Prime';
        inhabitants = 'The Synthesists';
        mothership = 'Synaptic Voyager';
        leader = 'The Algorithmic Consensus';
        weaponry = 'Quantum Disruptor';
        population = '4.2 Billion';
        dayLength = '36 Hours';
        radius = '6,850 km';
        break;
      case 'hestia':
        temperature = '612°C';
        majorCity = 'Ignis Dominion';
        inhabitants = 'The Pyrolans';
        mothership = 'Pyrosphere';
        leader = 'Grand Ember Sovereign Ignitius';
        weaponry = 'Thermal Lance';
        population = '2.7 Billion';
        dayLength = '48 Hours';
        radius = '5,840 km';
        break;
      case 'lyra':
        temperature = '18°C';
        majorCity = 'Aquatica';
        inhabitants = 'The Aquarans';
        mothership = 'Wavecrest';
        leader = 'High Tidecaller Nerissa';
        weaponry = 'Hydro Trident';
        population = '2.8 Billion';
        dayLength = '32 Hours';
        radius = '5,980 km';
        break;
      case 'rath':
        temperature = '30°C';
        majorCity = 'Canopia';
        inhabitants = 'The Sylvari';
        mothership = 'Greenleaf';
        leader = 'Elder Thorne';
        weaponry = 'Vita Staff';
        population = '3.7 Billion';
        dayLength = '28 Hours';
        radius = '7,120 km';
        break;
      case 'aeronis':
        temperature = '-5°C';
        majorCity = 'Stratos';
        inhabitants = 'The Aether';
        mothership = 'Windborne';
        leader = 'Sky Marshal Zephyra';
        weaponry = 'Storm Conductor';
        population = '2.1 Billion';
        dayLength = '36 Hours';
        radius = '5,980 km';
        break;
      case 'solara':
        temperature = '78°C';
        majorCity = 'Nova Prime';
        inhabitants = 'The Solarians';
        mothership = 'Solar Sovereign';
        leader = 'Radiant Archon Helios';
        weaponry = 'Solar Lance';
        population = '3.2 Billion';
        dayLength = '22 Hours';
        radius = '6,180 km';
        break;
      default:
        temperature = '25°C';
        majorCity = 'Capital City';
        inhabitants = 'Native Species';
        mothership = 'The Defender';
        leader = 'Commander';
        weaponry = 'Plasma Cannon';
        population = '2.5 Billion';
        dayLength = '30 Hours';
        radius = '6,500 km';
    }
    
    // Update stat values
    const statLabels = document.querySelectorAll('.stat-value');
    if (statLabels.length >= 6) {
      statLabels[0].textContent = temperature;
      statLabels[1].textContent = population;
      statLabels[2].textContent = dayLength;
      statLabels[3].textContent = radius;
      statLabels[4].textContent = majorCity;
      statLabels[5].textContent = mothership;
    }
  }
  
  setupCollapsibleSections() {
    // No longer needed with the new layout
  }
  
  onWindowResize() {
    // Update camera aspect ratio
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    
    // Update renderer size
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    
    // Update composer size
    this.composer.setSize(window.innerWidth, window.innerHeight);
    
    // Re-fit planet name on tablet resize
    if (window.innerWidth <= 900) {
      const container = document.getElementById('planet-info-main');
      const el = container?.querySelector('.planet-name');
      if (el) {
        // Trigger fit by calling showPlanetInfo again with current text
        const currentName = el.textContent?.trim() || '';
        if (currentName) {
          this.applyTextReveal(el, currentName); // reset spans
          // temporary span stripped -> just text
          el.textContent = currentName;
          // compute fit
          let fontSize = 48;
          el.style.fontSize = fontSize + 'px';
          el.style.whiteSpace = 'nowrap';
          const maxWidth = container.clientWidth * 0.9;
          while (el.scrollWidth > maxWidth && fontSize > 12) {
            fontSize -= 1;
            el.style.fontSize = fontSize + 'px';
          }
        }
      }
    }
  }
  
  animate() {
    // ---- FPS Limiter (to reduce CPU/GPU load & save battery) ----
    const now = performance.now();
    const delta = now - this._lastFrameTime;

    // Only update and render if enough time has passed for target FPS
    if (delta >= this._frameInterval) {
      this._lastFrameTime = now - (delta % this._frameInterval);
    
    // Update controls
    this.controls.update();
    
    // Rotate planets
      this.planets.forEach(planet => {
        if (planet.userData && typeof planet.userData.rotationSpeed === 'number') {
        planet.rotation.y += planet.userData.rotationSpeed;
        } else {
          planet.rotation.y += 0.005; // Default rotation if not specified
        }
      });

      // Animate flying asteroids
      if (this.asteroids && this.asteroids.length > 0) {
        this.asteroids.forEach(asteroid => {
          asteroid.position.add(asteroid.userData.velocity.clone().multiplyScalar(delta * 0.1)); // Adjusted delta scaling
          asteroid.rotation.x += asteroid.userData.rotationSpeed.x;
          asteroid.rotation.y += asteroid.userData.rotationSpeed.y;

          // Check bounds and reset if asteroid is too far
          if (asteroid.position.lengthSq() > this.asteroidSpawnRadius * this.asteroidSpawnRadius * 1.5) { // Increased despawn radius slightly
            // Reset to a new position within spawn radius
            let newPosition = new THREE.Vector3(
              (Math.random() - 0.5) * this.asteroidSpawnRadius,
              (Math.random() - 0.5) * this.asteroidSpawnRadius,
              (Math.random() - 0.5) * this.asteroidSpawnRadius
            );
            // Ensure not too close to center
            if (newPosition.length() < 50) {
              newPosition.normalize().multiplyScalar(50 + Math.random() * 50);
            }
            asteroid.position.copy(newPosition);

            // Give it a new random velocity
            const speedFactor = 0.05;
            asteroid.userData.velocity.set(
              (Math.random() - 0.5) * speedFactor,
              (Math.random() - 0.5) * speedFactor,
              (Math.random() - 0.5) * speedFactor
            );
          }
        });
      }
      
      // Animate X-shaped asteroid belts around Planet-X
    if (this.asteroidBelts) {
      this.asteroidBelts.forEach(belt => {
          if (belt.userData && belt.userData.planetRef && belt.userData.rotationAxis && belt.userData.rotationSpeed) {
            // Rotate around the planet's current position
            belt.position.copy(belt.userData.planetRef.position); 
            belt.rotateOnAxis(belt.userData.rotationAxis, belt.userData.rotationSpeed * 10); // Increased speed
          }
        });
      }

      // Animate laser beams
      this.lasers.forEach((laser, index) => {
        laser.position.add(laser.userData.velocity);
        // Remove laser if it travels too far (e.g., misses)
        if (laser.position.lengthSq() > 100000) { // Arbitrary large distance
          this.scene.remove(laser);
          this.lasers.splice(index, 1);
        }
      });

      // Animate explosions
      if (this.explosions && this.explosions.length > 0) {
        for (let i = this.explosions.length - 1; i >= 0; i--) { // Iterate backwards for safe removal
          const explosion = this.explosions[i];
          const positionsAttribute = explosion.geometry.attributes.position;
          const velocities = explosion.userData.velocities; // Array of Vector3
          const startTime = explosion.userData.startTime;
          const duration = explosion.userData.duration;
          const elapsedTime = performance.now() - startTime;
          const progress = Math.min(elapsedTime / duration, 1.0);

          if (progress >= 1) {
            // Explosion finished
            this.scene.remove(explosion);
            explosion.geometry.dispose();
            explosion.material.dispose();
            this.explosions.splice(i, 1);
          } else {
            const scaledMovementFactor = delta * 0.05; // Reverted to delta-based, adjusted multiplier

            for (let k = 0; k < positionsAttribute.count; k++) {
              const k3 = k * 3;
              positionsAttribute.array[k3] += velocities[k].x * scaledMovementFactor;
              positionsAttribute.array[k3 + 1] += velocities[k].y * scaledMovementFactor;
              positionsAttribute.array[k3 + 2] += velocities[k].z * scaledMovementFactor;
            }
            positionsAttribute.needsUpdate = true;

            // Fade out material
            explosion.material.opacity = 1.0 - progress;
          }
        }
      }

      // Render scene with post-processing
    this.composer.render();
    }

    // Request next frame
    requestAnimationFrame(() => this.animate());
  }
  
  // Handle arrow key navigation
  onKeyDown(event) {
    // Handle navigation with arrow keys
    if (this.animating) return; // Prevent rapid navigation during camera animation
    
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      // First hide the current planet info with animation
      this.hidePlanetInfo();
      
      // After a delay, navigate to the next planet
      setTimeout(() => {
        // Navigate left or right in the planets array
        if (event.key === 'ArrowLeft') {
          this.currentPlanetIndex = (this.currentPlanetIndex - 1 + this.planets.length) % this.planets.length;
        } else if (event.key === 'ArrowRight') {
          this.currentPlanetIndex = (this.currentPlanetIndex + 1) % this.planets.length;
        }
        
        // Get the target planet
        const targetPlanet = this.planets[this.currentPlanetIndex];
        
        // Get planet name from userData
        const planetName = targetPlanet.name || targetPlanet.userData.name;
        
        // Move camera to new planet - will show info when animation completes
        this.moveCamera(targetPlanet, planetName);
      }, 600); // Wait for 600ms to allow panels to slide out
    }
  }
  
  // Add this new method for tracking zoom level
  setupZoomTracking() {
    // Track camera distance for deselection on zoom out
    this.lastCameraDistance = null;
    this.isZoomedOut = false;
    this.deselectionThreshold = 100; // Base threshold for deselection
    
    // Add event listener to controls for zoom tracking
    this.controls.addEventListener('change', () => {
      // Calculate distance from camera to target
      const distance = this.camera.position.distanceTo(this.controls.target);
      
      // If we have a selected planet
      if (this.selectedPlanet && !this.animating) {
        // Calculate planet size for proportional threshold
        const planetRadius = this.selectedPlanet.children[0].geometry.parameters.radius || 5;
        const deselectionDistance = planetRadius * 12; // Increased from 7 to allow zooming out further
        
        // If we've zoomed out beyond the threshold
        if (distance > deselectionDistance && !this.isZoomedOut) {
          this.isZoomedOut = true;
          this.hidePlanetInfo();
          
          // Reset controls constraints to allow free navigation
          this.controls.minDistance = 20;
          this.controls.maxDistance = 400; // reduced 20%
          
          // Reset selection state
          this.selectedPlanet = null;
          this.planetIndex = -1;
          this.currentPlanetIndex = -1;
        }
        // If we're zoomed back in after being zoomed out
        else if (distance <= deselectionDistance && this.isZoomedOut) {
          this.isZoomedOut = false;
        }
      }
      
      this.lastCameraDistance = distance;
      
      // Update zoom indicator
      const minD = this.controls.minDistance || 1;
      const maxD = this.controls.maxDistance || 800; // reduced 20%
      const progress = Math.max(0, Math.min(1, (maxD - distance) / (maxD - minD)));
      document.querySelectorAll('.zoom-indicator .fill').forEach(el => {
        el.style.height = `${progress * 100}%`;
      });
    });
  }

  getLeaderInfo(planetName) {
    switch(planetName.toLowerCase()) {
      case 'drakko':
        return {
          name: "High Forge Lord Pyragoth",
          description: "A towering infernoid with ancient volcanic shards embedded in his obsidian skin. Pyragoth rules through strength and fear, demanding constant tribute and expansion of Drakko's empire. His body temperature is so extreme that he must wear specially crafted armor to prevent melting everything he touches."
        };
      case 'planet-x':
        return {
          name: "Unknown Entity",
          description: "The true leadership of Planet-X remains a mystery. Some believe the planet itself is sentient, while others theorize that ancient automated systems continue to execute the will of long-gone creators. Occasional manifestations of energy in humanoid form have been reported but never confirmed."
        };
      case 'rath':
        return {
          name: "Elder Thorne",
          description: "A wise and ancient Sylvari whose body has partially merged with the sacred World Tree of Rath. Elder Thorne can simultaneously experience all parts of the planet's vast forest network. Their decisions are based on the collective wisdom of generations of flora and fauna memories stored within the planet's biosphere."
        };
      case 'aeronis':
        return {
          name: "Sky Marshal Zephyra",
          description: "Born in the highest floating metropolis of Stratos, Zephyra's body has evolved with enhanced lung capacity and hollow bones. Her leadership style emphasizes freedom and innovation, while maintaining the delicate balance of Aeronis's atmospheric ecosystem. She communicates with the wind currents themselves, predicting planetary changes months in advance."
        };
      case 'toppo':
        return {
          name: "The Algorithmic Consensus",
          description: "Unlike other civilizations, Toppo has no single leader but is governed by a distributed intelligence network called the Algorithmic Consensus. This hyper-advanced quantum AI integrates the collective wisdom of millions of Synthesists while running countless simulations to predict optimal outcomes for the society. The Consensus manifests physically through holographic interfaces when interaction with other species is necessary, taking a form that appears as a shifting geometric pattern of light with a calm, multi-layered voice that speaks with perfect precision."
        };
      case 'hestia':
        return {
          name: "Grand Ember Sovereign Ignitius",
          description: "The culmination of a thousand-year dynasty of fire-blooded rulers, Ignitius stands over eight feet tall, with skin that glows with internal heat and veins that pulse with living flame. Unlike previous rulers who governed through fear, Ignitius leads with a philosopher's wisdom, believing that like fire, civilization requires both fuel and proper containment to thrive. His touch can ignite or extinguish flame at will, and he regularly immerses himself in the sacred lava pools beneath the Ignis Dominion to commune directly with Hestia's molten core, emerging with prophetic visions about cosmic threats and opportunities."
        };
      case 'lyra':
        return {
          name: "High Tidecaller Nerissa",
          description: "Nerissa is distinguished by her iridescent blue skin and the intricate network of bio-luminescent patterns that pulse with the tides of Lyra. As High Tidecaller, she possesses an unparalleled connection to the planet's oceans, able to commune with its deepest depths and most ancient creatures. She leads through wisdom and harmony, seeking balance between technological advancement and preservation of Lyra's marine ecosystems."
        };
      default:
        return {
          name: "Leader",
          description: "The ruler or governing entity of this planet, embodying their cultural values and directing their civilization's development."
        };
    }
  }
  
  // Setup mobile planet navigation arrows
  setupMobileNavigation() {
    const prevBtn = document.getElementById('prev-planet-btn');
    const nextBtn = document.getElementById('next-planet-btn');
    const mobileNameEl = document.querySelector('#mobile-planet-name .planet-title');
    
    if (!prevBtn || !nextBtn) return;
    
    const navigateToPlanet = (direction) => {
      if (this.animating || !this.planets || this.planets.length === 0) return;
      
      let currentIndex = this.planetIndex >= 0 ? this.planetIndex : 0;
      let newIndex = direction === 'next' 
        ? (currentIndex + 1) % this.planets.length 
        : (currentIndex - 1 + this.planets.length) % this.planets.length;
      
      this.planetIndex = newIndex;
      const targetPlanet = this.planets[newIndex];
      
      if (targetPlanet) {
        // Trigger the same logic as keyboard navigation
        const event = new KeyboardEvent('keydown', { key: direction === 'next' ? 'ArrowRight' : 'ArrowLeft' });
        this.onKeyDown(event);
        
        // Update mobile name after a short delay to ensure planetIndex is updated
        setTimeout(() => {
          if (this._updateMobileName) this._updateMobileName();
        }, 100);
      }
    };
    
    prevBtn.addEventListener('click', () => navigateToPlanet('prev'));
    nextBtn.addEventListener('click', () => navigateToPlanet('next'));
    
    // Update mobile name when planet changes
    const updateMobileName = () => {
      if (!mobileNameEl) return;
      if (this.planetIndex >= 0 && this.planets[this.planetIndex]) {
        const planet = this.planets[this.planetIndex];
        const planetName = planet.userData.name || 'PLANET';
        const planetNum = (this.planetIndex + 1).toString().padStart(2, '0');
        mobileNameEl.textContent = `${planetName.toUpperCase()} / ${planetNum}`;
      } else {
        mobileNameEl.textContent = 'EXPLORE THE UNIVERSE';
      }
    };
    
    // Call initially and store reference for updates
    this._updateMobileName = updateMobileName;
    updateMobileName();
  }
  
  // New method to handle mouse move for planet hovering
  onMouseMove(event) {
    // Check if we're animating - skip during animation
    if (this.animating) return;
    
    // Create raycaster
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    // Convert mouse position to normalized device coordinates
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // Set the raycaster based on mouse position and camera
    raycaster.setFromCamera(mouse, this.camera);
    
    // Filter out non-interactive objects for raycasting
    const interactiveObjects = this.scene.children.filter(obj => !obj.userData.noInteractive);
    
    // Check for intersections with planets
    const intersects = raycaster.intersectObjects(interactiveObjects, true);
    
    // Get reference to the scene container
    const sceneContainer = document.getElementById('scene-container');
    
    if (intersects.length > 0) {
      // Try to find the parent planet group
      let planetObj = intersects[0].object;
      while (planetObj.parent && !this.planets.includes(planetObj)) {
        planetObj = planetObj.parent;
      }
      
      // If we found a planet in our planets array
      if (this.planets.includes(planetObj)) {
        // Add hover class to scene container
        sceneContainer.classList.add('hovering-planet');
        
        // Preload images for this planet on hover
        const planetName = planetObj.userData.name;
        if (planetName) {
          this.preloadPlanetImages(planetName);
        }
        
        return;
      }
    }
    
    // If we didn't find a planet or there are no intersections
    sceneContainer.classList.remove('hovering-planet');
  }

  // --- REVISED Method for Arrow Button PAGINATION (Debug Version 2 - Fresh Container Ref) ---
  setupLocationArrows() {
    console.log(">>> Setting up location pagination arrows...");

    // --- Get FRESH reference to scroll container INSIDE this function ---
    const scrollContainer = document.querySelector('#planet-modal .modal-content');
    console.log("Fresh scrollContainer query result:", scrollContainer); 
    if (!scrollContainer) {
        console.error("Location pagination: Cannot find .modal-content container!");
        return;
    }
    // --- End Fresh Ref ---

    // --- Find elements relative to the FRESH container reference ---
    const locationsSection = scrollContainer.querySelector('.locations-section');
    console.log("Found locationsSection:", locationsSection); 
    
    const locationsContainer = locationsSection?.querySelector('.section-content'); // The scroll container (80vh)
    console.log("Found locationsContainer (scroll area):", locationsContainer);

    const locationList = locationsContainer?.querySelector('.location-list'); // The list inside
    console.log("Found locationList:", locationList);
    // --- End Element Find ---

    if (!locationsSection || !locationsContainer || !locationList) {
        console.warn("Location pagination: Setup failed - Section, Container or List not found.");
        return; // Stop if elements aren't found
    }

    // --- Remove potential old controls/arrows ---
    locationsSection.querySelector('.location-controls')?.remove();

    // --- Create Controls Container ---
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'location-controls';
    console.log("Created controlsDiv:", controlsDiv);

    // --- Create Buttons ---
    const btnLeft = document.createElement('button');
    btnLeft.type = 'button';
    btnLeft.className = 'scroll-arrow left'; 
    btnLeft.setAttribute('aria-label', 'Previous location');
    // Inline SVG icon for left arrow
    btnLeft.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M10 2 L4 8 L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;

    const btnRight = document.createElement('button');
    btnRight.type = 'button';
    btnRight.className = 'scroll-arrow right'; 
    btnRight.setAttribute('aria-label', 'Next location');
    // Inline SVG icon for right arrow
    btnRight.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M6 2 L12 8 L6 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
    console.log("Created buttons:", btnLeft, btnRight);

    // --- Append Buttons to Controls Div ---
    controlsDiv.appendChild(btnLeft);
    controlsDiv.appendChild(btnRight);

    // --- Append Controls Div to Section ---
    locationsSection.appendChild(controlsDiv); 
    console.log("Appended controlsDiv to locationsSection.");

    // --- Focus-based carousel logic ---
    const locationItems = Array.from(locationList.querySelectorAll('.location-item'));
    if (locationItems.length === 0) {
      console.warn('No location items found');
      return;
    }

    let focusIndex = 0;

    const setFocus = (newIndex, skipScroll = false) => {
      if (newIndex < 0 || newIndex >= locationItems.length) return;
      focusIndex = newIndex;
      locationItems.forEach((item, idx) => {
        item.classList.toggle('focused', idx === focusIndex);
      });
      if (!skipScroll) {
        // Bring item into horizontal view without affecting vertical scroll
        const itemEl = locationItems[focusIndex];
        // Manually calculate horizontal center scroll to avoid ancestor vertical scrolling
        const itemOffsetLeft = itemEl.offsetLeft;
        const itemWidth = itemEl.offsetWidth;
        const containerWidth = locationsContainer.clientWidth;
        const targetScrollLeft = itemOffsetLeft - (containerWidth - itemWidth) / 2;
        locationsContainer.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
      }
      // Update arrow visibility
      btnLeft.classList.toggle('hidden', focusIndex === 0);
      btnRight.classList.toggle('hidden', focusIndex === locationItems.length - 1);
    };

    // Initialise first focus without scrolling (prevents vertical jump on modal open)
    setFocus(0, true);

    // Click-to-focus on individual location items
    locationItems.forEach((item, idx) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        setFocus(idx);
      });
    });

    // Arrow click handlers
    const leftClickListener = (e) => {
      e.stopPropagation();
      setFocus(focusIndex - 1);
    };
    const rightClickListener = (e) => {
      e.stopPropagation();
      setFocus(focusIndex + 1);
    };

    btnLeft.addEventListener('click', leftClickListener);
    btnRight.addEventListener('click', rightClickListener);

    // Store references for cleanup
    this._locationsContainerForListener = locationsContainer; 
    this._locationControlsDiv = controlsDiv; 
    this._locationArrowLeft = btnLeft; 
    this._locationArrowRight = btnRight;
    this._leftClickListener = leftClickListener; 
    this._rightClickListener = rightClickListener;
    // no scroll listener needed for this carousel approach
    this._locationsScrollHandler = null;
    
    console.log("Location pagination arrows setup complete.");

  } // --- End setupLocationArrows ---

  // --- REVISED Cleanup Method ---
  removeLocationArrows() {
     console.log(">>> Removing location pagination arrows...");
     
     // Use the specific container reference stored during setup
     const locationsContainer = this._locationsContainerForListener; 
     
     // Remove listeners first using stored references
     if(locationsContainer && this._locationsScrollHandler) {
       locationsContainer.removeEventListener('scroll', this._locationsScrollHandler);
       console.log("Removed scroll listener from:", locationsContainer);
     } else {
       console.log("Scroll listener or container not found for removal.");
     }
     this._locationArrowLeft?.removeEventListener('click', this._leftClickListener);
     this._locationArrowRight?.removeEventListener('click', this._rightClickListener);

     // Remove the controls container (which removes buttons)
     this._locationControlsDiv?.remove(); 
     
     // Clear references
     this._locationsContainerForListener = null;
     this._locationControlsDiv = null;
     this._locationsScrollHandler = null; 
     this._locationArrowLeft = null; 
     this._locationArrowRight = null;
     this._leftClickListener = null;
     this._rightClickListener = null;
  }

  /* ------------------------------------------------
     Helper: Animated letter-by-letter text reveal
  ------------------------------------------------ */
  applyTextReveal(element, text) {
    if (!element) return;
    // Reset content
    element.textContent = text;
    const chars = [...text];
    element.innerHTML = '';
    chars.forEach((ch, idx) => {
      const span = document.createElement('span');
      span.className = 'reveal-letter';
      span.textContent = ch === ' ' ? '\u00A0' : ch; // preserve spaces
      span.style.animationDelay = `${idx * 40}ms`;
      element.appendChild(span);
    });
  }

  /* --------------------------------------------------
      LASER & EXPLOSION EFFECTS FOR ASTEROID SHOOTING
  -------------------------------------------------- */
  shootLaserAt(asteroid) {
    // Get world position of asteroid for explosion
    const end = asteroid.getWorldPosition(new THREE.Vector3());
    const asteroidColor = asteroid.material.color.clone(); // Get the asteroid's color

    // Create explosion at asteroid location and remove asteroid
    this.createExplosion(end, asteroidColor); // Pass the color
    
    // Play explosion sound
    if (window.playExplosionSound) {
      window.playExplosionSound();
    }

    // Remove asteroid from scene & array
    this.scene.remove(asteroid);
    this.asteroids = this.asteroids.filter(a => a !== asteroid);
  }

  createExplosion(position, color) { // Added color parameter
    const particleCount = 200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = []; // This will store Vector3s

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      positions[i3] = position.x;
      positions[i3 + 1] = position.y;
      positions[i3 + 2] = position.z;

      // random direction velocity for each particle
      const dir = new THREE.Vector3(
        (Math.random() - 0.5),
        (Math.random() - 0.5),
        (Math.random() - 0.5)
      ).normalize().multiplyScalar(Math.random() * 0.6 + 0.3); // Adjusted speed (0.3 to 0.9)
      velocities.push(dir);
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: color || 0xffaa00, // Use passed color, fallback to orange
      size: 0.8,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      sizeAttenuation: true,
      map: this.createCircleTexture(), // Use circular texture
      alphaTest: 0.5 // Handle texture transparency
    });

    const points = new THREE.Points(geometry, material);
    points.userData = {
      startTime: performance.now(),
      velocities: velocities, // Store the array of Vector3 velocities
      duration: 1500 // ms, Increased duration to 1.5 seconds
    };
    this.scene.add(points);
    this.explosions.push(points);
  }

  /* ---------------------------------------------------------
     3-D Planet Preview (Next-Planet Section)
  --------------------------------------------------------- */
  createPlanetPreview(container, planetName) {
    // Ensure previous preview disposed/stopped
    this.removePlanetPreview();

    if (!container) return;
    
    // Reuse renderer
    const renderer = this._previewRenderer;
    const scene = this._previewScene;
    const camera = this._previewCamera;

    // Size calculations
    let width = container.clientWidth;
    let height = container.clientHeight;
    if (!width || width === 0) {
      width = (container.parentElement?.clientWidth || window.innerWidth) * 0.45;
    }
    if (!height || height === 0) {
      height = width; // make square
    }
    
    // Attach to new container
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);
    this._previewContainer = container; // Keep track

    // Planet mesh setup
    const texture = this.textureLoader.load(`textures/${planetName.toLowerCase()}-texture.png`);
    const geometry = new THREE.SphereGeometry(1, 32, 32);
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    
    // Store for cleanup (rotation, removal)
    this._previewMesh = mesh;

    // Animation loop
    const animate = () => {
      // Slow rotation
      if (this._previewMesh) {
          this._previewMesh.rotation.y += 0.002;
      }
      renderer.render(scene, camera);
      this._previewAnimId = requestAnimationFrame(animate);
    };
    animate();

    // Ensure renderer matches displayed size after CSS rules applied
    const resizePreview = () => {
      // If detached, stop
      if (!renderer.domElement.parentElement) return; 
      
      const cw = renderer.domElement.clientWidth;
      const ch = renderer.domElement.clientHeight;
      if (cw && ch) {
        renderer.setSize(cw, ch, false);
        camera.aspect = cw / ch;
        camera.updateProjectionMatrix();
      }
    };

    // Call initially (next tick to ensure layout) and on resize
    requestAnimationFrame(resizePreview);
    window.addEventListener('resize', resizePreview);
    this._previewResizeHandler = resizePreview;
  }

  removePlanetPreview() {
    // Stop loop
    if (this._previewAnimId) {
        cancelAnimationFrame(this._previewAnimId);
        this._previewAnimId = null;
    }
    
    // Remove resize listener
    if (this._previewResizeHandler) {
        window.removeEventListener('resize', this._previewResizeHandler);
        this._previewResizeHandler = null;
    }

    // Detach renderer
    if (this._previewContainer && this._previewRenderer.domElement.parentElement === this._previewContainer) {
        this._previewContainer.removeChild(this._previewRenderer.domElement);
    }
    this._previewContainer = null;

    // Cleanup mesh logic
    if (this._previewMesh) {
        this._previewScene.remove(this._previewMesh);
        this._previewMesh.geometry.dispose();
        this._previewMesh.material.map?.dispose(); // Dispose texture
        this._previewMesh.material.dispose();
        this._previewMesh = null;
    }
    // Do NOT dispose renderer or scene as they are reused
  }

  /* ------------------------------------------------
     Helper: Scramble text effect (top tagline)
  ------------------------------------------------ */
  scrambleText(element, newText) {
    if (!element) return;
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%&*?";
    const oldText = element.textContent;
    const length = Math.max(oldText.length, newText.length);
    const queue = [];
    for (let i = 0; i < length; i++) {
      const from = oldText[i] || '';
      const to = newText[i] || '';
      const start = Math.floor(Math.random() * 20);
      const end = start + Math.floor(Math.random() * 40);
      queue.push({ from, to, start, end, char: '' });
    }

    let frame = 0;
    cancelAnimationFrame(this._scrambleRAF);

    const update = () => {
      let output = '';
      let complete = 0;
      for (let i = 0; i < queue.length; i++) {
        let { from, to, start, end, char } = queue[i];
        if (frame >= end) {
          complete++;
          output += to;
        } else if (frame >= start) {
          if (!char || Math.random() < 0.28) {
            char = chars[Math.floor(Math.random() * chars.length)];
            queue[i].char = char;
          }
          output += `<span class=\"dud\">${char}</span>`;
        } else {
          output += from;
        }
      }
      element.innerHTML = output;
      if (complete === queue.length) {
        element.textContent = newText;
      } else {
        frame++;
        this._scrambleRAF = requestAnimationFrame(update);
      }
    };

    update();
  }

  /* ------------------------------------------------
     Update planets explored status text
  ------------------------------------------------ */
  updateExploreProgress() {
    const progressEl = document.getElementById('explore-progress');
    if (progressEl) {
      const valueEl = progressEl.querySelector('.value');
      if (valueEl) {
        valueEl.textContent = `${this.exploredPlanets.size}/${this.TOTAL_PLANETS}`;
      }
    }
  }

  /* ------------------ CORONA PARTICLE EFFECT - REMOVED ------------------ */
  // createCorona(planet){ ... } // Entire method removed
  // removeCorona(){ ... } // Entire method removed
}

// Initialize app when window loads
window.addEventListener('load', () => {
  new PlanetExplorer();
}); 