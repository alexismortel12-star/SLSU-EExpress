/**
 * ============================================================
 * PROJECT: SLSU EExpress+ Smart Cloud Locker
 * VERSION: 9.2.0 (Structured 4-Phase IoT Workflow)
 * ============================================================
 * CORE STATE LOGIC:
 * - Phase 1 (Courier Drop-Off): Auth -> Select Locker -> Unlock & LED ON -> 10s Watchdog -> Secured.
 * - Phase 2 (Recipient Verification): Confirms Ownership -> Payment Check -> Rejection Handling.
 * - Phase 3 (Recipient Retrieval): 'Ready' -> TFT QR Gen -> Scan -> Unlock & LED ON -> 10s Watchdog.
 * - Phase 4 (Exception Handling): Anti-Theft Breach States & Active TFT Monitor UI Mirroring.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getDatabase, ref, onValue, push, update, get, runTransaction, set, remove } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

// ==========================================
// 1. FIREBASE SECURE INITIALIZATION
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyCA9WYXtv_-SBu0mXuenjIweUjgm8qza9Y",
    authDomain: "slsu-eexpress-plus.firebaseapp.com",
    databaseURL: "https://slsu-eexpress-plus-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "slsu-eexpress-plus",
    storageBucket: "slsu-eexpress-plus.firebasestorage.app",
    messagingSenderId: "1077938592700",
    appId: "1:1077938592700:web:0616ecbb43c611c8c269b9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth();
const db = getDatabase(app);
const storage = getStorage(app);

// ==========================================
// 2. GLOBAL SYSTEM STATE & CAMERA VARS
// ==========================================
let systemInit = false;
let lastOccupiedState = { 1: false, 2: false };
let selPayment = "Prepaid";
let walletBal = 0.00;
let watchdogTimers = { 1: null, 2: null };

let html5QrcodeScanner = null;
let currentRetrievingLocker = 0;
let expectedRetrievalToken = "";

// Injecting Cyber-Veridian Keyframes for dynamic animations
const styleInject = document.createElement('style');
styleInject.innerHTML = `
    @keyframes pulseVeridian { 0% { opacity: 0.4; text-shadow: 0 0 5px #39ff14; } 50% { opacity: 1; text-shadow: 0 0 20px #39ff14; } 100% { opacity: 0.4; text-shadow: 0 0 5px #39ff14; } }
    @keyframes scanReticle { 0% { border-color: #39ff14; box-shadow: 0 0 10px #39ff14; } 50% { border-color: #a0e8af; box-shadow: inset 0 0 20px #39ff14; } 100% { border-color: #39ff14; box-shadow: 0 0 10px #39ff14; } }
`;
document.head.appendChild(styleInject);

// ==========================================
// 3. UI ENGINE & HAPTIC FEEDBACK
// ==========================================
window.notify = (msg, type = "info") => {
    const container = document.getElementById('toast-container');
    if (!container) return; 

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = "ℹ️";
    
    // Cyber-Veridian UI Overrides
    toast.style.background = "rgba(18, 22, 20, 0.85)";
    toast.style.backdropFilter = "blur(10px)";
    toast.style.fontFamily = "monospace";
    toast.style.color = "#ffffff";
    toast.style.border = "1px solid #00ffcc";

    if (type === 'success') {
        icon = "[✓]";
        toast.style.border = "1px solid #39ff14";
        toast.style.color = "#39ff14";
        toast.style.boxShadow = "0 0 15px rgba(57, 255, 20, 0.3)";
    }
    if (type === 'error') {
        icon = "[!]";
        toast.style.border = "1px solid #ff3333";
        toast.style.color = "#ff3333";
    }
    
    toast.innerHTML = `<span style="font-size:1.5rem;">${icon}</span> <div>${msg}</div>`;
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
    }, 4000);

    if ("vibrate" in navigator) {
        if (type === 'error') navigator.vibrate([200, 100, 200]);
        if (type === 'success') navigator.vibrate([50, 50, 100]); // Subdued mechanical haptic for UI success
    }
};

window.toggleLoader = (show, text = "ENERGIZING CLOUD...") => {
    const loader = document.getElementById('loading-overlay');
    const lText = document.getElementById('loading-text');
    if (lText) lText.innerText = text.toUpperCase();
    if (loader) loader.style.display = show ? 'flex' : 'none';
};

// ==========================================
// 4. HARDWARE WATCHDOG (SECURITY LOGIC) - Phase 1 & 3
// ==========================================
window.startDoorTimer = (n) => {
    if (watchdogTimers[n]) clearTimeout(watchdogTimers[n]);
    
    // Modified to exact 10-second countdown requirement
    watchdogTimers[n] = setTimeout(async () => {
        const snap = await get(ref(db, `system_control/locker_${n}`));
        const state = snap.val();

        if (state && (state.lock_command === "UNLOCKED" || state.door_state === "OPEN")) {
            await update(ref(db, `system_control/locker_${n}`), { buzzer_alarm: true });
            notify(`CRITICAL ALERT: Locker 0${n} door left open!`, "error");
            document.body.classList.add("alarm-active");
        }
    }, 10000); 
};

window.stopDoorAlarm = async (n) => {
    if (watchdogTimers[n]) clearTimeout(watchdogTimers[n]);
    document.body.classList.remove("alarm-active");
    await update(ref(db, `system_control/locker_${n}`), {
        lock_command: "LOCKED",
        buzzer_alarm: false,
        led_state: false // Ensures LED turns off when door secures
    });
};

// ==========================================
// 5. AUTHENTICATION MODULE (ROLE ROUTING)
// ==========================================
const loginBtn = document.getElementById("loginBtn");
if (loginBtn) {
    loginBtn.onclick = async () => {
        const email = document.getElementById("emailField").value;
        const pass = document.getElementById("passwordField").value;
        if(!email || !pass) return notify("Enter Credentials", "error");

        toggleLoader(true, "AUTHORIZING...");
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, pass);
            const uid = userCredential.user.uid;
            
            let role = "recipient";
            if (uid === "CzTMNl1oIwefB1t6iuVa6Cg65dD3" || email === "alexis_courier@gmail.com") {
                role = "courier";
            } else if (uid === "iNS6Y20LdpQAe8tqUUjedRi1gMr1" || email === "alexis_monitor@gmail.com") {
                role = "monitor";
            }
            
            localStorage.setItem("userRole", role);
            location.reload();
        } catch (e) {
            toggleLoader(false);
            notify("Access Denied: Invalid Account", "error");
        }
    };
}

onAuthStateChanged(auth, (user) => {
    const authOverlay = document.getElementById("auth-pane") || document.getElementById("auth-overlay");
    const appBody = document.getElementById("app-body");

    if (user) {
        let role = localStorage.getItem("userRole");
        if (!role) {
            if (user.uid === "CzTMNl1oIwefB1t6iuVa6Cg65dD3" || user.email === "alexis_courier@gmail.com") role = "courier";
            else if (user.uid === "iNS6Y20LdpQAe8tqUUjedRi1gMr1" || user.email === "alexis_monitor@gmail.com") role = "monitor";
            else role = "recipient";
            localStorage.setItem("userRole", role);
        }
        window.userRole = role;
        
        const navCourier = document.getElementById("nav-courier");
        const navRecipient = document.getElementById("nav-recipient");
        const navMonitor = document.getElementById("nav-monitor"); 

        if (authOverlay) authOverlay.style.display = "none";
        if (appBody) appBody.style.display = "flex";
        
        if (navCourier) navCourier.style.display = window.userRole === "courier" ? "flex" : "none";
        if (navRecipient) navRecipient.style.display = window.userRole === "recipient" ? "flex" : "none";
        if (navMonitor) navMonitor.style.display = window.userRole === "monitor" ? "flex" : "none";
        
        let targetPane = "r-dashboard";
        if (window.userRole === "courier") targetPane = "c-dashboard";
        if (window.userRole === "monitor") targetPane = "m-dashboard";
        
        window.showPane(targetPane);
        startGlobalListeners();
    } else {
        if (authOverlay) authOverlay.style.display = "flex";
        if (appBody) appBody.style.display = "none";
        toggleLoader(false);
    }
});

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
    logoutBtn.onclick = () => {
        signOut(auth).then(() => { localStorage.clear(); location.reload(); });
    };
}

// ==========================================
// 6. MASTER SYNC: CLOUD, HARDWARE & MONITOR
// ==========================================
function startGlobalListeners() {
    const userUID = auth.currentUser.uid;

    onValue(ref(db, `user_wallets/${userUID}`), (snap) => {
        const val = snap.val();
        if (val === null) {
            walletBal = 100.00;
            set(ref(db, `user_wallets/${userUID}`), 100.00);
        } else {
            walletBal = parseFloat(val);
        }
        const balUI = document.getElementById('wallet-bal');
        if (balUI) balUI.innerText = walletBal.toFixed(2);
    });

    onValue(ref(db, "system_stats/total_revenue"), (snap) => {
        const rev = snap.val() || 0;
        const el = document.getElementById('total-rev');
        if (el) el.innerText = parseFloat(rev).toFixed(2);
    });

    onValue(ref(db, "system_control"), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        [1, 2].forEach(num => {
            const locker = data[`locker_${num}`];
            const card = document.getElementById(`grid-l${num}`);
            const statusLabel = document.getElementById(`status-l${num}`);
            const weightBadge = document.getElementById(`weight-l${num}`);
            const ledDot = document.getElementById(`dot-l${num}`);
            const overlay = document.getElementById('opening-overlay');

            if (card && locker) {
                if (weightBadge) weightBadge.innerText = `${Math.round(locker.weight_status)}g`;
                if (ledDot) {
                    locker.led_state ? ledDot.classList.add('led-on') : ledDot.classList.remove('led-on');
                }

                // Phase 4 Exception: Anti-Theft / Breach State Check
                if (locker.security_status === "BREACH") {
                    card.className = "locker-card locker-breach";
                    if(statusLabel) statusLabel.innerText = "SECURITY BREACH";
                    document.body.classList.add("alarm-active");
                }
                else if (locker.state === "DROPPING_OFF") {
                    card.className = "locker-card locker-warning";
                    if(statusLabel) statusLabel.innerText = "DEPOSITING...";
                    if (overlay && overlay.style.display === 'flex' && locker.weight_status > 45) {
                        const depInst = document.getElementById('hud-instr');
                        const wConf = document.getElementById('weight-confirm-icon');
                        const btnDep = document.getElementById('btn-deposit-close');
                        if(depInst) depInst.innerHTML = "📦 PARCEL SENSED!<br>Please close door securely.";
                        if(wConf) wConf.style.display = 'block';
                        if(btnDep) btnDep.style.display = 'block';
                    }
                }
                else if (locker.is_occupied) {
                    card.className = "locker-card locker-occupied";
                    if(statusLabel) statusLabel.innerText = "SECURED";
                    document.body.classList.remove("alarm-active");
                }
                else {
                    card.className = "locker-card locker-available";
                    if(statusLabel) statusLabel.innerText = "READY";
                    document.body.classList.remove("alarm-active");
                }
                lastOccupiedState[num] = locker.is_occupied;
            }

            // Phase 4: TFT MONITOR ROLE - UI Mirroring & Real-time QR Display Engine
            if (window.userRole === "monitor" && locker.ui_session) {
                const qrContainer = document.getElementById(`qr-display-l${num}`);
                if (qrContainer) {
                    
                    // Display hardware loading/processing states before idle or QR
                    if (locker.state === "DROPPING_OFF" || locker.state === "PICKING_UP") {
                        qrContainer.style.background = "transparent";
                        qrContainer.style.border = "none";
                        qrContainer.innerHTML = `
                            <div style="color:#00ffcc; font-family: monospace; font-size: 2rem; text-align: center; animation: pulseVeridian 1.5s infinite;">
                                <div class="loader" style="margin: 0 auto 15px auto;"></div>
                                ...PROCESSING TRANSACTION...<br>
                                <span style="font-size: 1rem; opacity: 0.8;">Hardware Sync in Progress</span>
                            </div>`;
                    }
                    else if (locker.ui_session.ready_to_scan && locker.ui_session.monitor_qr_token !== "EMPTY") {
                        if(qrContainer.innerHTML.indexOf("TERMINAL") !== -1 || qrContainer.innerHTML.indexOf("PROCESSING") !== -1 || qrContainer.innerHTML === "") {
                            qrContainer.innerHTML = "";
                            // Generating Cyber-Veridian styled QR Code for the physical monitor
                            new QRCode(qrContainer, { text: locker.ui_session.monitor_qr_token, width: 280, height: 280, colorDark: "#39ff14", colorLight: "#0a0f0c" });
                            qrContainer.style.background = "#0a0f0c";
                            qrContainer.style.border = "3px solid #39ff14";
                            qrContainer.style.padding = "15px";
                            qrContainer.style.boxShadow = "0 0 40px rgba(57, 255, 20, 0.4)";
                            qrContainer.style.borderRadius = "8px";
                        }
                    } else {
                        // Secure Idle State: Breathing Logo to prevent screen-sniffing
                        qrContainer.style.background = "transparent";
                        qrContainer.style.border = "none";
                        qrContainer.style.boxShadow = "none";
                        qrContainer.innerHTML = `
                            <div style="color:#39ff14; font-family: monospace; font-size: 2.2rem; text-align: center; animation: pulseVeridian 3s infinite;">
                                <div style="font-size: 4rem; margin-bottom: 10px;">🛡️</div>
                                [ TERMINAL L-0${num} IDLE ]<br>
                                <span style="font-size: 1.2rem; opacity: 0.7;">Awaiting Handshake</span>
                            </div>`;
                    }
                }
            }
        });
        systemInit = true;
    });

    onValue(ref(db, "parcels"), (snapshot) => {
        const courierList = document.getElementById("pending-list");
        const recList = document.getElementById("recipient-content");
        const courierHist = document.getElementById("courier-past-list");
        const recHist = document.getElementById("history-content");

        if (courierList) courierList.innerHTML = "";
        if (recList) recList.innerHTML = "";
        if (courierHist) courierHist.innerHTML = "";
        if (recHist) recHist.innerHTML = "";

        snapshot.forEach((child) => {
            const p = child.val();
            const id = child.key;
            if (p.status === "Ready") return;
            
            const activityHtml = `
                <div class="card" style="padding:25px; display:flex; justify-content:space-between; align-items:center; border:1px solid rgba(57, 255, 20, 0.2); background: rgba(10, 15, 12, 0.6); margin-bottom: 15px;">
                    <div>
                        <span style="font-size:1.4rem; font-family: monospace; font-weight:900; color: #fff;">${p.receiver}</span> 
                        <span style="color:#39ff14; font-weight:800; font-family: monospace;">(L-0${p.locker})</span><br>
                        <small style="color:#a0e8af; font-family: monospace;">🕒 ${p.timestamp}</small>
                    </div>
                    <span class="status-tag" style="color:#39ff14; border: 1px solid #39ff14; padding: 8px 16px; border-radius: 4px; font-weight: bold; font-family: monospace; background: rgba(57, 255, 20, 0.1);">${p.status.toUpperCase()}</span>
                </div>`;

            if (window.userRole === "courier") {
                if (p.status === "Picked Up" || p.status === "Completed" || p.status === "Rejected") {
                    if (courierHist) courierHist.innerHTML += activityHtml;
                } else {
                    if (courierList) courierList.innerHTML += activityHtml;
                }
            } else if (window.userRole === "recipient") {
                if (p.status === "Picked Up" || p.status === "Completed" || p.status === "Rejected") {
                    if (recHist) recHist.innerHTML += activityHtml;
                } else if (p.status === "Awaiting Verification") {
                    // PHASE 2: RECIPIENT VERIFICATION (Rider Info Dashboard)
                    if (recList) {
                        recList.innerHTML += `
                            <div class="card" style="background: rgba(15, 20, 15, 0.8); backdrop-filter: blur(10px); border: 1px solid rgba(57, 255, 20, 0.4); box-shadow: 0 0 20px rgba(57, 255, 20, 0.1); border-radius: 12px;">
                                <h3 style="color: #39ff14; font-family: monospace; text-transform: uppercase; border-bottom: 1px solid rgba(57, 255, 20, 0.3); padding-bottom: 10px; margin-bottom: 15px;">> Rider Info Dashboard</h3>
                                <img src="${p.photo}" style="width:100%; border-radius:8px; margin-bottom:15px; border: 1px solid #39ff14; filter: contrast(1.1) brightness(0.9);">
                                <p style="font-size:1.4rem; font-weight:bold; color: #fff; font-family: monospace;">TARGET: <span style="color: #39ff14;">${p.receiver}</span></p>
                                
                                <div style="background: rgba(57, 255, 20, 0.05); border-left: 3px solid #39ff14; padding: 15px; margin: 15px 0;">
                                    <p style="font-size:0.9rem; color: #a0e8af; font-family: monospace; margin-bottom: 5px;">[LOGGED COURIER]</p>
                                    <p style="font-size:1.1rem; color: #fff; font-family: monospace; margin: 0;">Agent: ${p.courier_name || 'UNKNOWN'}</p>
                                </div>
                                
                                <p style="font-size:1.1rem; color: #39ff14; margin-bottom: 20px; text-align: center; font-family: monospace; font-weight: bold; text-shadow: 0 0 8px rgba(57, 255, 20, 0.6);">CONFIRM PARCEL OWNERSHIP</p>
                                
                                <div style="display:flex; gap:15px; justify-content: center;">
                                    <button class="btn" style="background: rgba(57, 255, 20, 0.1); border: 1px solid #39ff14; color: #39ff14; font-family: monospace; transition: 0.3s; box-shadow: inset 0 0 5px rgba(57, 255, 20, 0.2);" onclick="window.vfy('${id}', true, ${p.locker})" onmouseover="this.style.background='rgba(57, 255, 20, 0.3)'" onmouseout="this.style.background='rgba(57, 255, 20, 0.1)'">[ AUTHORIZE ]</button>
                                    <button class="btn" style="background: transparent; border: 1px solid #ff3333; color: #ff3333; font-family: monospace;" onclick="window.vfy('${id}', false, ${p.locker})">[ REJECT ]</button>
                                </div>
                            </div>`;
                    }
                } else if (p.status === "Verified") {
                    if (p.payment_status === 'Pending') {
                        // PHASE 2: PAYMENT HANDLING (Paylater logic)
                        if (recList) {
                            recList.innerHTML += `
                                <div class="card" style="border: 1px solid #ff3333; background: rgba(25, 10, 10, 0.8);">
                                    <h3 style="margin-bottom: 20px; font-family: monospace; color: #ff3333;">FUNDS REQUIRED: ₱${p.amount}</h3>
                                    <button class="btn" style="background: #ff3333; color: #fff; font-family: monospace; border: none;" onclick="window.payWallet('${id}')">SETTLE VIA WALLET</button>
                                </div>`;
                        }
                    } else {
                        // PHASE 2 & 3: PREPARATION FOR SCANNING
                        if (recList) {
                            recList.innerHTML += `
                                <div class="card" style="background: rgba(10, 15, 12, 0.9); border: 1px solid #39ff14; box-shadow: 0 0 20px rgba(57, 255, 20, 0.15); text-align: center;">
                                    <h3 style="font-size: 1.8rem; margin-bottom: 15px; color: #39ff14; font-family: monospace; text-shadow: 0 0 10px rgba(57, 255, 20, 0.4);">SYSTEM SECURED: L-0${p.locker}</h3>
                                    <p style="color: #a0e8af; font-family: monospace; margin-bottom: 25px;">Hardware linked. Initiate handshake when physically present at the terminal to prevent unauthorized access.</p>
                                    <button class="btn" style="background: #39ff14; color: #0a0f0c; font-family: monospace; font-size: 1.3rem; font-weight: bold; border: none; box-shadow: 0 0 15px rgba(57, 255, 20, 0.6); transition: 0.3s;" onclick="window.triggerReadyToScan(${p.locker}, '${p.token}')" onmouseover="this.style.boxShadow='0 0 30px rgba(57, 255, 20, 0.9)'" onmouseout="this.style.boxShadow='0 0 15px rgba(57, 255, 20, 0.6)'">> READY TO SCAN _</button>
                                </div>`;
                        }
                    }
                }
            }
        });
        toggleLoader(false); 
    });
}

// ==========================================
// 7. PHASE 1: COURIER OPERATIONS
// ==========================================
window.setPayment = (type) => {
    selPayment = type;
    const btnPre = document.getElementById('btn-pre');
    const btnPay = document.getElementById('btn-pay');
    if(btnPre) btnPre.style.borderColor = (type === 'Prepaid') ? '#39ff14' : 'rgba(255,255,255,0.2)';
    if(btnPay) btnPay.style.borderColor = (type === 'Pay Later') ? '#39ff14' : 'rgba(255,255,255,0.2)';
};

window.previewPhoto = (input) => {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.getElementById("preview-img");
            if (img) { img.src = e.target.result; img.style.display = "block"; }
        };
        reader.readAsDataURL(input.files[0]);
    }
};

window.proceedToGrid = () => {
    const recName = document.getElementById("rec-name");
    const courName = document.getElementById("cour-name");
    if (!recName || !recName.value || !courName || !courName.value) return notify("Missing Details", "error");
    document.getElementById("drop-step-1").style.display = "none";
    document.getElementById("drop-step-2").style.display = "block";
};

window.backToStep1 = () => {
    document.getElementById("drop-step-1").style.display = "block";
    document.getElementById("drop-step-2").style.display = "none";
};

window.selectLocker = async (num) => {
    const hSnap = await get(ref(db, `system_control/locker_${num}`));
    if (hSnap.val().is_occupied) return notify(`Locker 0${num} is occupied!`, "error");

    const fCam = document.getElementById("f-cam");
    if (!fCam || !fCam.files[0]) return notify("Photo Evidence Required", "error");
    
    const file = fCam.files[0];
    const amt = document.getElementById('amount-due').value || "0.00";
    
    toggleLoader(true, "ENERGIZING LOCKER...");
    try {
        const sPath = sRef(storage, `parcels/${Date.now()}`);
        const uploadSnap = await uploadBytes(sPath, file);
        const photoLink = await getDownloadURL(uploadSnap.ref);
        const secureToken = Math.random().toString(36).substring(2, 10).toUpperCase();

        // PHASE 1: Hardware Activation - Unlocks Solenoid AND turns on LED Strip
        const lockerUpdates = {
            "lock_command": "UNLOCKED",
            "state": "DROPPING_OFF",
            "buzzer_alarm": false,
            "security_status": "SECURE",
            "led_state": true, // LED Automatically Illuminates Drop-Off Space
            "ui_session/delivery_status": "AWAITING_CONFIRMATION",
            "ui_session/rider_name": document.getElementById('cour-name').value,
            "ui_session/rider_contact": document.getElementById('cour-phone').value,
            "ui_session/recipient_email": document.getElementById("rec-name").value,
            "ui_session/is_confirmed": false,
            "ui_session/ready_to_scan": false,
            "ui_session/monitor_qr_token": secureToken
        };
        
        await update(ref(db, `system_control/locker_${num}`), lockerUpdates);
        startDoorTimer(num); // Begins 10-Second Countdown

        await push(ref(db, "parcels"), {
            receiver: document.getElementById("rec-name").value,
            phone: document.getElementById("rec-phone").value,
            courier_name: document.getElementById("cour-name").value,
            amount: amt,
            payment_type: selPayment,
            payment_status: (selPayment === 'Prepaid' ? 'Completed' : 'Pending'),
            locker: num, photo: photoLink, token: secureToken,
            status: "Awaiting Verification", timestamp: new Date().toLocaleString()
        });

        toggleLoader(false);
        const overlay = document.getElementById('opening-overlay');
        if (overlay) {
            overlay.setAttribute('data-locker', num);
            overlay.style.display = 'flex';
        }
    } catch (err) {
        toggleLoader(false);
        notify("Cloud Sync Failed", "error");
    }
};

window.closeOpeningOverlay = () => {
    const overlay = document.getElementById('opening-overlay');
    if (!overlay) return location.reload();
    const num = overlay.getAttribute('data-locker');
    if (num) stopDoorAlarm(num);
    overlay.style.display = 'none';
    location.reload();
};

// ==========================================
// 8. PHASE 2 & 3: RECIPIENT & GATEKEEPER OPS
// ==========================================
window.vfy = async (id, isMine, lockerNum) => {
    if (isMine) {
        await update(ref(db, `parcels/${id}`), { status: "Verified" });
        if (lockerNum) {
            await update(ref(db, `system_control/locker_${lockerNum}`), { 
                "ui_session/is_confirmed": true 
            });
        }
        notify("Ownership Authorized.", "success");
    } else {
        // Phase 2 Rejection Logging Handling
        if (confirm("Reject this delivery?")) {
            await update(ref(db, `parcels/${id}`), { status: "Rejected" });
            if (lockerNum) {
                // Notifies courier by updating UI Session delivery status
                await update(ref(db, `system_control/locker_${lockerNum}`), { 
                    "ui_session/delivery_status": "REJECTED"
                });
            }
            notify("Parcel Rejected. Courier Notified.", "error");
        }
    }
};

window.triggerReadyToScan = async (lockerNum, token) => {
    // PHASE 3: QR Code Generation Signal via Firebase
    await update(ref(db, `system_control/locker_${lockerNum}`), { 
        "ui_session/ready_to_scan": true 
    });
    window.openCameraScanner(token, lockerNum);
    notify("Link established. Scan terminal QR.", "success");
};

window.payWallet = async (id) => {
    const snap = await get(ref(db, `parcels/${id}`));
    const p = snap.val();
    const cost = parseFloat(p.amount);

    if (walletBal >= cost) {
        toggleLoader(true, "PROCESSING TRANSACTION...");
        setTimeout(async () => {
            const userUID = auth.currentUser.uid;
            await set(ref(db, `user_wallets/${userUID}`), walletBal - cost);
            await update(ref(db, `parcels/${id}`), { payment_status: 'Completed' });
            runTransaction(ref(db, "system_stats/total_revenue"), (current) => (current || 0) + cost);

            const invId = document.getElementById('inv-id');
            const invLocker = document.getElementById('inv-locker');
            const invAmount = document.getElementById('inv-amount');
            if(invId) invId.innerText = id.substring(1, 8).toUpperCase();
            if(invLocker) invLocker.innerText = `0${p.locker}`;
            if(invAmount) invAmount.innerText = `₱${p.amount}`;

            toggleLoader(false);
            document.getElementById('invoice-overlay').style.display = 'flex';
        }, 1500);
    } else { notify("Insufficient Funds", "error"); }
};

window.closeInvoice = () => {
    document.getElementById('invoice-overlay').style.display = 'none';
};

// ==========================================
// 9. THE WEB-CAMERA SCANNER (PHASE 3 RETRIEVAL)
// ==========================================
window.openCameraScanner = (tokenToMatch, lockerNum) => {
    currentRetrievingLocker = lockerNum;
    expectedRetrievalToken = tokenToMatch;
    
    const camOverlay = document.getElementById('camera-overlay');
    camOverlay.style.display = 'flex';
    camOverlay.style.background = "rgba(10, 15, 12, 0.98)";
    camOverlay.style.animation = "scanReticle 2s infinite";

    if (html5QrcodeScanner) html5QrcodeScanner.clear();
    html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 }, false);
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
};

window.stopCameraScanner = () => {
    if (html5QrcodeScanner) html5QrcodeScanner.clear();
    document.getElementById('camera-overlay').style.display = 'none';
    if (currentRetrievingLocker) {
        update(ref(db, `system_control/locker_${currentRetrievingLocker}`), { 
            "ui_session/ready_to_scan": false 
        });
    }
};

function onScanSuccess(decodedText) {
    if (decodedText === expectedRetrievalToken) {
        stopCameraScanner();
        
        // HAPTIC & VISUAL ANIMATION
        if ("vibrate" in navigator) {
            navigator.vibrate([100, 50, 100, 50, 200]); // Strong satisfaction click pattern
        }

        // Emerald Validation Pulse UI Injection
        const authPulse = document.createElement('div');
        authPulse.style = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(10, 15, 12, 0.98); z-index:99999; display:flex; align-items:center; justify-content:center; flex-direction:column; font-family:monospace;";
        authPulse.innerHTML = `
            <div style="font-size: 5rem; color: #39ff14; text-shadow: 0 0 40px rgba(57, 255, 20, 0.8); margin-bottom: 20px;">[ VALIDATED ]</div>
            <div style="font-size: 1.5rem; color: #a0e8af; animation: pulseVeridian 1s infinite;">Executing Hardware Command...</div>
        `;
        document.body.appendChild(authPulse);
        
        setTimeout(() => authPulse.remove(), 2500);
        
        // PHASE 3: Hardware Unlocking & LED Strip Engagement for Withdrawal
        const unlockUpdates = {
            "state": "PICKING_UP",
            "lock_command": "UNLOCKED",
            "led_state": true, // Turns on the LED strip to illuminate parcel removal
            "ui_session/delivery_status": "COMPLETED",
            "ui_session/rider_name": "EMPTY",
            "ui_session/rider_contact": "EMPTY",
            "ui_session/recipient_email": "EMPTY",
            "ui_session/is_confirmed": false,
            "ui_session/ready_to_scan": false,
            "ui_session/monitor_qr_token": "EMPTY"
        };

        update(ref(db, `system_control/locker_${currentRetrievingLocker}`), unlockUpdates)
            .then(() => {
                notify("Solenoid Unlocked. Secure retrieval.", "success");
                startDoorTimer(currentRetrievingLocker); // Begins final 10-Second Countdown to Secure
            })
            .catch((error) => {
                console.error("Firebase Rule Blocked the Unlock:", error);
                notify("System Blocked Command: Rule Error", "error");
            });

    } else {
        notify("Invalid Token Signature", "error");
    }
}

function onScanFailure(error) {}

// ==========================================
// 10. NAVIGATION & SYSTEM TOOLS
// ==========================================
window.showPane = (id) => {
    document.querySelectorAll(".pane").forEach(p => p.style.display = "none");
    const pane = document.getElementById(id);
    if(pane) pane.style.display = "block";
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    
    let navId = "";
    if (id === 'r-dashboard') navId = 'nav-rec';
    if (id === 'r-history') navId = 'nav-his';
    if (id === 'c-dashboard') navId = 'nav-dash';
    if (id === 'c-drop-off') navId = 'nav-drop';
    if (id === 'm-dashboard') navId = 'nav-mon';
    
    const navEl = document.getElementById(navId);
    if(navEl) navEl.classList.add('active');
};

window.toggleCourierHistory = () => {
    const el = document.getElementById('courier-history-card');
    el.style.display = (el.style.display === 'none') ? 'block' : 'none';
};

const devResetBtn = document.getElementById("devResetBtn");
if (devResetBtn) {
    devResetBtn.onclick = async () => {
        if(!confirm("⚠️ FACTORY RESET?")) return;
        toggleLoader(true, "FORMATTING CLOUD...");
        try {
            const safeState = { 
                state: "AVAILABLE", lock_command: "LOCKED", door_state: "CLOSED", 
                buzzer_alarm: false, scanner_power: false, is_occupied: false, 
                weight_status: 0, active_token: "EMPTY", security_status: "SECURE", led_state: false,
                ui_session: {
                    delivery_status: "STANDBY", rider_name: "EMPTY", rider_contact: "EMPTY",
                    recipient_email: "EMPTY", is_confirmed: false, ready_to_scan: false, monitor_qr_token: "EMPTY"
                }
            };
            await set(ref(db, "system_control"), { locker_1: safeState, locker_2: safeState });
            await set(ref(db, "parcels"), null);
            await set(ref(db, "system_stats/total_revenue"), 0);
            location.reload();
        } catch (e) { toggleLoader(false); }
    };
}
