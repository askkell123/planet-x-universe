# Planet-X Universe Explorer

An interactive 3D experience to explore the planets of the Planet-X universe. Built with Three.js and modern web technologies.

## Features

- Explore 11 unique planets in 3D space
- Interactive camera controls for navigation
- Detailed information panels for each planet
- Smooth animations and transitions
- Responsive design

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm start
```

3. Open your browser and navigate to `http://localhost:5173`

## Controls

- **Left Mouse Button**: Rotate camera
- **Right Mouse Button**: Pan camera
- **Mouse Wheel**: Zoom in/out
- **WASD**: Move camera
- **Space**: Move up
- **Shift**: Move down

## Planet Information

Each planet displays the following information when clicked:
- Name
- Description
- Key Locations
- Major City
- Mothership
- Inhabitants
- Master of the Inhabitants
- Special Weapon

## Development

The project uses:
- Three.js for 3D rendering
- GSAP for animations
- Vite for development and building

## Building for Production

To create a production build:

```bash
npm run build
```

The built files will be in the `dist` directory. 