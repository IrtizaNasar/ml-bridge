/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // Premium Dark Theme Palette
                background: '#0a0a0a', // MidJourney/Runway style almost-black
                surface: '#121212',    // Slightly lighter for cards
                primary: '#3b82f6',    // Vibrant blue accent
                secondary: '#8b5cf6',  // Purple accent
                accent: '#f472b6',     // Pink accent for gradients
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
            }
        },
    },
    plugins: [],
}
