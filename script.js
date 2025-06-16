// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    const backgroundAudio = document.getElementById('background-audio');
    if (backgroundAudio) { // Ensure element exists before setting volume
        backgroundAudio.volume = 0.5; // Set volume to 50%
    }
    const muteButton = document.getElementById('mute-button');
    const lottieContainer = document.getElementById('audio-lottie-container');
    const clickSfx = document.getElementById('click-sfx');
    const explosionSfx = document.getElementById('explosion-sfx'); // Added explosion SFX element
    let lottieAnimation;

    // Load Lottie Animation
    if (lottieContainer && typeof lottie !== 'undefined') {
        lottieAnimation = lottie.loadAnimation({
            container: lottieContainer,
            renderer: 'svg',
            loop: true,
            autoplay: false, // Will be controlled by audio state
            path: 'lotties/audio-wave.json', // Path to your Lottie file (updated to .json)
            rendererSettings: {
                xhrSettings: {
                    responseType: 'text'
                }
            }
        });
    } else {
        if (!lottieContainer) console.error('Lottie container not found.');
        if (typeof lottie === 'undefined') console.error('Lottie library (lottie.min.js) not loaded.');
    }

    // Function to attempt to play audio and handle Lottie
    function playAudioAndSyncLottie() {
        if (!backgroundAudio) return;

        // Audio can only be played after user interaction in most modern browsers
        // So, we can't reliably autoplay here if it's not muted.
        // Instead, we ensure Lottie is paused if audio is initially muted or not playing.
        if (backgroundAudio.muted || backgroundAudio.paused) {
            if (lottieAnimation) lottieAnimation.pause();
        } else {
            if (lottieAnimation) lottieAnimation.play();
        }
    }
    
    // Set initial state
    if (backgroundAudio) {
        // Start muted, as autoplay with sound is often blocked.
        backgroundAudio.muted = true; 
        console.log('Attempting to play background audio (muted)...');
        backgroundAudio.play()
            .then(() => {
                console.log('Background audio playback initiated (muted).');
                playAudioAndSyncLottie(); // Sync Lottie after successful play initiation
            })
            .catch(error => {
                console.warn('Background audio autoplay (even muted) was prevented:', error);
                playAudioAndSyncLottie(); // Still sync Lottie to ensure it's paused if audio failed
            });
    } else {
      playAudioAndSyncLottie(); // Call to ensure Lottie is paused if audio element doesn't exist
    }

    // Mute Button Functionality
    if (muteButton && backgroundAudio && lottieAnimation) {
        muteButton.addEventListener('click', () => {
            backgroundAudio.muted = !backgroundAudio.muted;
            
            if (backgroundAudio.muted) {
                lottieAnimation.pause();
                console.log('Background audio muted. Lottie paused.');
            } else {
                console.log('Background audio unmuted.');
                // If audio was paused (e.g., by autoplay restriction or never started), play it now.
                if (backgroundAudio.paused) {
                     console.log('Background audio was paused, attempting to play...');
                     backgroundAudio.play()
                        .then(() => {
                            console.log('Background audio playback started on unmute.');
                            lottieAnimation.play();
                        })
                        .catch(e => console.error("Error playing background audio on unmute:", e));
                } else {
                    lottieAnimation.play();
                    console.log('Background audio already playing. Lottie playing.');
                }
            }
        });
    } else {
        if (!muteButton) console.error('Mute button not found.');
        if (!backgroundAudio) console.error('Background audio element not found.');
        // Lottie animation error already handled
    }
    
    // Sync Lottie if audio starts playing for other reasons or on visibility change
    if (backgroundAudio && lottieAnimation) {
        backgroundAudio.addEventListener('play', () => {
            if (!backgroundAudio.muted) {
                lottieAnimation.play();
            }
        });
        backgroundAudio.addEventListener('pause', () => {
            // Pause Lottie if audio is paused (unless it's only paused because it's muted by us)
             if (backgroundAudio.paused && !backgroundAudio.muted) { // only pause lottie if audio externally paused AND not muted
                 // lottieAnimation.pause(); // Optional: pause Lottie if tab is hidden etc.
             } else if (backgroundAudio.muted) {
                 lottieAnimation.pause();
             }
        });
    }

    // Function to play the click sound
    function playClickSound() {
        const sfxElement = document.getElementById('click-sfx'); // Attempt to get it directly here
        if (sfxElement) {
            sfxElement.currentTime = 0; 
            sfxElement.play().catch(error => {
                console.warn('Click sound playback error:', error); // Log any play error
            });
        } else {
            console.error('Click SFX audio element still not found inside playClickSound!'); 
        }
    }

    // Add a global click listener to document.body
    document.body.addEventListener('click', function(event) {
        // Define selectors for interactive elements that should trigger the click sound
        const interactiveSelectors = [
            'button', 
            'a[href]', 
            '.explore-button', 
            '.close-modal', 
            '.pagination-dot',
            '.scroll-arrow',
            '.page-arrow',
            '.controls-pill',
            '.close-controls',
            '#mute-button'
            // Add other selectors as needed
        ];

        // Check if the clicked element or its ancestor matches any of the selectors
        const clickedInteractiveElement = event.target.closest(interactiveSelectors.join(','));

        if (clickedInteractiveElement) {
            // console.log('Interactive element clicked:', clickedInteractiveElement);
            playClickSound();
        }
    });

    // Expose the explosion sound function globally for main.js to use
    window.playExplosionSound = function() {
        if (explosionSfx) {
            explosionSfx.currentTime = 0; // Rewind to start
            explosionSfx.play().catch(error => {
                console.warn('Explosion sound playback error:', error);
            });
        } else {
            console.error('Explosion SFX audio element not found!');
        }
    };

    // Function to set up Planet Tagline SVG rotation on scroll
    function setupTaglineRotation() {
        const planetTaglineSVG = document.querySelector('.insignia-section .planet-tagline');
        const modalContent = document.querySelector('.modal-content');

        if (planetTaglineSVG && modalContent) {
            console.log('Found planet tagline SVG and modal content for rotation.'); // Diagnostic
            let lastKnownScrollPosition = 0;
            let ticking = false;

            function updateRotation(scrollPos) {
                const rotationSpeedFactor = 0.1; // Adjust this to control speed/sensitivity
                const rotation = scrollPos * rotationSpeedFactor;
                planetTaglineSVG.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
            }

            modalContent.addEventListener('scroll', () => {
                lastKnownScrollPosition = modalContent.scrollTop;
                if (!ticking) {
                    window.requestAnimationFrame(() => {
                        updateRotation(lastKnownScrollPosition);
                        const rotation = lastKnownScrollPosition * 0.1; // Recalculate for logging
                        // console.log('Modal ScrollTop:', lastKnownScrollPosition, 'Calculated Rotation:', rotation); // Keep for now
                        ticking = false;
                    });
                    ticking = true;
                }
            });
            updateRotation(modalContent.scrollTop);
        } else {
            if (!planetTaglineSVG) console.error('Planet tagline SVG not found for scroll rotation (inside setupTaglineRotation).');
            if (!modalContent) console.error('Modal content not found for scroll rotation event (inside setupTaglineRotation).');
        }
    }
    window.setupTaglineRotation = setupTaglineRotation; // Expose it globally for main.js
}); 