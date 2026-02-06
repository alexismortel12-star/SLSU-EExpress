import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
  import {
    getAuth,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
  } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
  import {
    getDatabase,
    ref,
    set,
    onValue,
    push,
    update
  } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

  // Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCA9WYXtv_-SBu0mXuenjIweUjgm8qza9Y",
  authDomain: "slsu-eexpress-plus.firebaseapp.com",
  databaseURL: "https://slsu-eexpress-plus-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "slsu-eexpress-plus",
  storageBucket: "slsu-eexpress-plus.firebasestorage.app",
  messagingSenderId: "1077938592700",
  appId: "1:1077938592700:web:0616ecbb43c611c8c269b9"
};

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const auth = getAuth();
  const db = getDatabase(app);

  // UI elements
  const loginBtn = document.getElementById("loginBtn");
  const authMsg = document.getElementById("authMsg");
  const appBody = document.getElementById("app-body");
  const authOverlay = document.getElementById("auth-overlay");

  // Login Logic with Role-Based Redirection
  loginBtn.onclick = async () => {
    authMsg.textContent = "Authenticating...";
    const email = document.getElementById("emailField").value;
    const pass = document.getElementById("passwordField").value;

    try {
      await signInWithEmailAndPassword(auth, email, pass);
      // Logic for passwords from system description
      if (email === "alexismortel12@gmail.com" && pass === "121203") {
          window.userRole = "courier";
      } else if (email === "alexismortel12@gmail.com" && pass === "051923") {
          window.userRole = "recipient";
      } else {
          window.userRole = "user";
      }
    } catch (e) {
      authMsg.textContent = "Login Failed: " + e.message;
    }
  };

  document.getElementById("logoutBtn").onclick = () => {
      signOut(auth).then(() => location.reload());
  };

  // Auth state monitor
  onAuthStateChanged(auth, (user) => {
    if (user) {
      authOverlay.style.display = "none";
      appBody.style.display = "flex";
      
      // Reveal the correct sidebars/panes
      document.getElementById("nav-courier").style.display = window.userRole === "courier" ? "block" : "none";
      document.getElementById("nav-recipient").style.display = window.userRole === "recipient" ? "block" : "none";
      
      showPane(window.userRole === "courier" ? "c-dashboard" : "r-dashboard");
      startSystemListeners();
    } else {
      authOverlay.style.display = "flex";
      appBody.style.display = "none";
    }
  });

  // --- SLSU EExpress+ Core Functions ---

  function startSystemListeners() {
    // 1. Listen for Parcel Activities (History)
    const parcelsRef = ref(db, "parcels");
    onValue(parcelsRef, (snapshot) => {
      const pendingList = document.getElementById("pending-list");
      const pastList = document.getElementById("past-list");
      if (!pendingList || !pastList) return;

      pendingList.innerHTML = "";
      pastList.innerHTML = "";

      snapshot.forEach((child) => {
        const parcel = child.val();
        const itemHtml = `
          <div class="activity-item">
            <span><strong>${parcel.receiver}</strong><br><small>${parcel.timestamp}</small></span>
            <span class="status-pill ${parcel.status === 'Pending' ? 'pill-pending' : 'pill-completed'}">${parcel.status}</span>
          </div>`;

        if (parcel.status === "Pending") pendingList.innerHTML += itemHtml;
        else pastList.innerHTML += itemHtml;
      });
    });

    // 2. Listen for Physical Locker Status (Locker 1)
    onValue(ref(db, "system_control/locker_1"), (snapshot) => {
        const data = snapshot.val();
        const lockerCard = document.getElementById("locker-1-card");
        if (lockerCard && data) {
            lockerCard.className = data.is_occupied ? "locker-card locker-occupied" : "locker-card locker-available";
            lockerCard.innerHTML = `L-01 (${data.is_occupied ? 'OCCUPIED' : 'AVAILABLE'})`;
        }
    });
  }

  // --- Courier Actions ---

  // Called when "Complete Registration" is clicked
  window.submitParcel = () => {
    const receiverName = document.getElementById("rec-name").value;
    const receiverContact = document.getElementById("rec-contact").value;

    if (!receiverName) return alert("Please enter Receiver Name");

    // 1. Send Unlock Command to ESP32
    update(ref(db, "system_control/locker_1"), {
      lock_command: "UNLOCKED",
      is_occupied: false
    });

    // 2. Log the parcel in the database
    const newParcelRef = push(ref(db, "parcels"));
    set(newParcelRef, {
      receiver: receiverName,
      contact: receiverContact,
      status: "Pending",
      timestamp: new Date().toLocaleString()
    });

    alert("Unlock command sent! Place parcel inside and wait for ESP32 confirmation.");
    showPane("c-dashboard");
  };

  // UI helper
  window.showPane = (id) => {
    document.querySelectorAll(".pane").forEach(p => p.style.display = "none");
    document.getElementById(id).style.display = "block";
  };