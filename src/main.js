import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { gsap } from 'gsap';

// Planet data structure with visual properties
const planets = [
    { 
        name: 'planet-x', 
        position: new THREE.Vector3(0, 0, 0),
        color: 0xff0000,
        size: 3,
        hasRings: true,
        ringColor: 0xff6600,
        rotationSpeed: 0.005
    },
    { 
        name: 'rath', 
        position: new THREE.Vector3(25, 15, -20),
        color: 0x00ff00,
        size: 2.5,
        hasAtmosphere: true,
        atmosphereColor: 0x00ff00,
        rotationSpeed: 0.007
    },
    { 
        name: 'drakko', 
        position: new THREE.Vector3(-30, -10, 15),
        color: 0x0000ff,
        size: 2.8,
        hasRings: true,
        ringColor: 0x000066,
        rotationSpeed: 0.004
    },
    { 
        name: 'aeronis', 
        position: new THREE.Vector3(15, -25, -25),
        color: 0xffff00,
        size: 2.2,
        hasAtmosphere: true,
        atmosphereColor: 0xffff00,
        rotationSpeed: 0.006
    },
    { 
        name: 'akaria', 
        position: new THREE.Vector3(-20, 20, 30),
        color: 0xff00ff,
        size: 2.6,
        hasRings: true,
        ringColor: 0xff00ff,
        rotationSpeed: 0.003
    },
    { 
        name: 'lyra', 
        position: new THREE.Vector3(35, -15, 10),
        color: 0x00ffff,
        size: 2.4,
        hasAtmosphere: true,
        atmosphereColor: 0x00ffff,
        rotationSpeed: 0.005
    },
    { 
        name: 'galeon', 
        position: new THREE.Vector3(-25, -30, -15),
        color: 0xff6600,
        size: 2.7,
        hasRings: true,
        ringColor: 0xff6600,
        rotationSpeed: 0.004
    },
    { 
        name: 'toppo', 
        position: new THREE.Vector3(20, 30, -25),
        color: 0x6600ff,
        size: 2.3,
        hasAtmosphere: true,
        atmosphereColor: 0x6600ff,
        rotationSpeed: 0.006
    },
    { 
        name: 'hestia', 
        position: new THREE.Vector3(-35, 15, 20),
        color: 0xff0066,
        size: 2.9,
        hasRings: true,
        ringColor: 0xff0066,
        rotationSpeed: 0.003
    },
    { 
        name: 'solara', 
        position: new THREE.Vector3(30, 25, 25),
        color: 0xffff00,
        size: 2.5,
        hasAtmosphere: true,
        atmosphereColor: 0xffff00,
        rotationSpeed: 0.005
    },
    { 
        name: 'zepharo', 
        position: new THREE.Vector3(-15, -35, -30),
        color: 0x00ff66,
        size: 2.4,
        hasRings: true,
        ringColor: 0x00ff66,
        rotationSpeed: 0.004
    }
];

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

// Controls setup
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// Camera position
camera.position.z = 50;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);

// Create starfield
function createStarfield() {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 2000; // Increased star count
    const positions = new Float32Array(starCount * 3);
    
    for (let i = 0; i < starCount * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 3000; // Increased spread
        positions[i + 1] = (Math.random() - 0.5) * 3000;
        positions[i + 2] = (Math.random() - 0.5) * 3000;
    }
    
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const starMaterial = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.1,
        transparent: true,
        opacity: 0.8
    });
    
    const starfield = new THREE.Points(starGeometry, starMaterial);
    scene.add(starfield);
    return starfield;
}

const starfield = createStarfield();

// Create orbital paths
function createOrbitalPath(planet) {
    const orbitGeometry = new THREE.RingGeometry(
        planet.position.length() - 0.5,
        planet.position.length() + 0.5,
        128
    );
    const orbitMaterial = new THREE.MeshBasicMaterial({
        color: 0x444444,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide
    });
    const orbit = new THREE.Mesh(orbitGeometry, orbitMaterial);
    orbit.rotation.x = Math.PI / 2;
    scene.add(orbit);
    return orbit;
}

// Create planets with unique appearances
const planetObjects = planets.map(planet => {
    // Create planet
    const geometry = new THREE.SphereGeometry(planet.size, 32, 32);
    const material = new THREE.MeshPhongMaterial({
        color: planet.color,
        emissive: planet.color,
        emissiveIntensity: 0.2
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(planet.position);
    mesh.userData.name = planet.name;
    mesh.userData.rotationSpeed = planet.rotationSpeed;
    scene.add(mesh);

    // Add rings if specified
    if (planet.hasRings) {
        const ringGeometry = new THREE.RingGeometry(planet.size * 1.2, planet.size * 1.5, 32);
        const ringMaterial = new THREE.MeshPhongMaterial({
            color: planet.ringColor,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide
        });
        const rings = new THREE.Mesh(ringGeometry, ringMaterial);
        rings.rotation.x = Math.PI / 2;
        mesh.add(rings);
    }

    // Add atmosphere if specified
    if (planet.hasAtmosphere) {
        const atmosphereGeometry = new THREE.SphereGeometry(planet.size * 1.1, 32, 32);
        const atmosphereMaterial = new THREE.MeshPhongMaterial({
            color: planet.atmosphereColor,
            transparent: true,
            opacity: 0.2,
            side: THREE.BackSide
        });
        const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
        mesh.add(atmosphere);
    }

    // Add orbital path
    const orbit = createOrbitalPath(planet);
    mesh.userData.orbit = orbit;

    return mesh;
});

// Raycaster for planet selection
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// UI Elements
const planetInfoPanel = document.querySelector('.planet-info');
const controlsInfoPanel = document.querySelector('.controls-info');

// Show controls panel by default
controlsInfoPanel.classList.add('active');

// Camera animation state
let isAnimatingCamera = false;
let cameraAnimFrame = null;
let startTime = null;
let startCameraPos = new THREE.Vector3();
let startCameraTarget = new THREE.Vector3();
let endCameraPos = new THREE.Vector3();
let endCameraTarget = new THREE.Vector3();
let animationDuration = 1500; // 1.5 seconds in milliseconds

// Event Listeners
window.addEventListener('resize', onWindowResize, false);
window.addEventListener('click', onMouseClick, false);

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onMouseClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(planetObjects);

    if (intersects.length > 0 && !isAnimatingCamera) {
        const selectedPlanet = intersects[0].object;
        showPlanetInfo(selectedPlanet.userData.name);
        
        // Highlight selected planet's orbit
        planetObjects.forEach(planet => {
            if (planet.userData.orbit) {
                planet.userData.orbit.material.opacity = 0.3;
            }
        });
        selectedPlanet.userData.orbit.material.opacity = 0.8;

        // Animate camera to planet
        animateCameraToPlanet(selectedPlanet);
    }
}

function animateCameraToPlanet(planet) {
    if (isAnimatingCamera) return;
    
    // Cancel any existing animation
    if (cameraAnimFrame) {
        cancelAnimationFrame(cameraAnimFrame);
    }
    
    isAnimatingCamera = true;
    controls.enabled = false;
    
    // Set start and end positions
    startCameraPos.copy(camera.position);
    startCameraTarget.copy(controls.target);
    
    // Calculate target camera position
    const distance = planet.size * 15;
    const direction = new THREE.Vector3()
        .subVectors(camera.position, planet.position)
        .normalize();
    
    endCameraPos.copy(planet.position).add(direction.multiplyScalar(distance));
    endCameraTarget.copy(planet.position);
    
    // Start animation timing
    startTime = Date.now();
    
    // Custom animation loop
    function animateFrame() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / animationDuration, 1.0);
        
        // Ease-in-out function
        const eased = progress < 0.5 
            ? 2 * progress * progress 
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        
        // Interpolate camera position and target
        camera.position.lerpVectors(startCameraPos, endCameraPos, eased);
        controls.target.lerpVectors(startCameraTarget, endCameraTarget, eased);
        
        // If animation is still running
        if (progress < 1.0) {
            cameraAnimFrame = requestAnimationFrame(animateFrame);
        } else {
            // Animation complete
            camera.position.copy(endCameraPos);
            controls.target.copy(endCameraTarget);
            isAnimatingCamera = false;
            controls.enabled = true;
            cameraAnimFrame = null;
        }
    }
    
    // Start animation
    cameraAnimFrame = requestAnimationFrame(animateFrame);
}

function showPlanetInfo(planetName) {
    // TODO: Update with actual planet data when available
    const planetData = {
        name: planetName,
        description: "Planet description will go here",
        keyLocations: "Key locations will go here",
        majorCity: "Major city will go here",
        mothership: "Mothership details will go here",
        inhabitants: "Inhabitant information will go here",
        master: "Master information will go here",
        specialWeapon: "Special weapon details will go here"
    };

    // Update panel content
    document.querySelector('.planet-name').textContent = planetData.name;
    document.querySelector('.planet-description').textContent = planetData.description;
    document.querySelector('.key-locations').textContent = planetData.keyLocations;
    document.querySelector('.major-city').textContent = planetData.majorCity;
    document.querySelector('.mothership').textContent = planetData.mothership;
    document.querySelector('.inhabitants').textContent = planetData.inhabitants;
    document.querySelector('.master').textContent = planetData.master;
    document.querySelector('.special-weapon').textContent = planetData.specialWeapon;

    // Show panel with animation
    planetInfoPanel.classList.add('active');
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    
    // Rotate planets at their individual speeds
    planetObjects.forEach(planet => {
        planet.rotation.y += planet.userData.rotationSpeed;
    });
    
    // Rotate starfield slowly
    starfield.rotation.y += 0.0001;
    
    // Only update controls when not in camera animation
    if (!isAnimatingCamera) {
        controls.update();
    }
    
    renderer.render(scene, camera);
}

animate(); 