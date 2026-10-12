// Public Firebase web settings (safe to ship: access is controlled by firestore.rules)
export const firebaseConfig = {
  apiKey: "AIzaSyDOWd5kIsq3rvGgaO5wLs18oQ5k9HHDjS0",
  authDomain: "armethods.firebaseapp.com",
  projectId: "armethods",
  storageBucket: "armethods.firebasestorage.app",
  messagingSenderId: "137360176854",
  appId: "1:137360176854:web:59edb614ffc47283c9fb77",
};

// The owner's email: the first sign-up with this address becomes the admin.
// Must match ownerEmail() in firestore.rules.
export const OWNER_EMAIL = "amanraju024@gmail.com";

// Optional TomTom Search API key (free tier, no card) for extra business coverage.
// Leave empty to search OpenStreetMap only.
export const TOMTOM_KEY = "";
