let ws;                 // Connexion WebSocket globale
let currentUser = null; // Nom utilisateur courant
let targetUser = null;  // Cible de l'appel WebRTC
let pc;                 // RTCPeerConnection WebRTC

// Configuration serveur STUN Google (pour NAT traversal)
const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// Fonction pour enregistrer un utilisateur via l'API backend (utilisée par index.html)
async function register() {
  const username = document.getElementById("username").value.trim();
  if (!username) {
    alert("Veuillez entrer un nom d'utilisateur.");
    return;
  }

  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username })
    });

    const data = await res.json();

    if (data.success) {
      currentUser = username;
      document.getElementById("status").textContent = "Inscription réussie. Connexion WebSocket...";
      document.getElementById("status").style.color = "green";
      // Redirection vers call.html après inscription réussie
      setTimeout(() => {
        window.location.href = `/static/call.html?user=${encodeURIComponent(username)}`;
      }, 1000);
    } else {
      alert(data.message);
    }
  } catch (error) {
    console.error("Erreur lors de l'inscription:", error);
    alert("Erreur serveur. Veuillez réessayer.");
  }
}

// Fonction pour se connecter (utilisée par index.html)
async function login() {
  const username = document.getElementById("username").value.trim();
  if (!username) {
    alert("Veuillez entrer un nom d'utilisateur.");
    return;
  }

  try {
    const res = await fetch(`/api/login?username=${encodeURIComponent(username)}`);
    const data = await res.json();

    if (data.success) {
      currentUser = username;
      document.getElementById("status").textContent = "Connexion réussie. Connexion WebSocket...";
      document.getElementById("status").style.color = "green";
      // Redirection vers call.html après connexion réussie
      setTimeout(() => {
        window.location.href = `/static/call.html?user=${encodeURIComponent(username)}`;
      }, 1000);
    } else {
      alert(data.message);
    }
  } catch (error) {
    console.error("Erreur lors de la connexion:", error);
    alert("Erreur serveur. Veuillez réessayer.");
  }
}

// Ouvre la connexion WebSocket vers le serveur de signalisation
function openWebSocket(username) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}/ws?username=${username}`);
  console.log(`Tentative de connexion WebSocket à ${protocol}//${window.location.host}/ws?username=${username}`);
 
  ws.onopen = () => {
    console.log("Connexion WebSocket ouverte.");
    ws.send(JSON.stringify({ type: "login", name: username }));
  };
 
  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    console.log("Message WebSocket reçu:", data);
 
    switch (data.type) {
      case "user_list":
        console.log("Liste des utilisateurs reçue:", data.users);
        updateUserList(data.users);
        break;
      case "offer":
        targetUser = data.name;
        console.log(`Offre WebRTC reçue de ${targetUser}.`);
        // Assurez-vous que les éléments de la page d'appel existent avant de les manipuler
        const targetNameDisplay = document.getElementById("target-name");
        const callSection = document.getElementById("call-section");
        if (targetNameDisplay) targetNameDisplay.textContent = targetUser;
        if (callSection) callSection.style.display = "block";
        await handleOffer(data.sdp);
        break;
      case "answer":
        console.log(`Réponse WebRTC reçue de ${data.name}.`);
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.sdp }));
        break;
      case "candidate":
        if (data.candidate) {
          console.log(`Candidat ICE reçu de ${data.name}.`);
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
        break;
      case "login":
        if (data.success) {
          const statusDiv = document.getElementById("status");
          if (statusDiv) {
            statusDiv.textContent = `Connecté en tant que ${username}`;
            statusDiv.style.color = "green";
          }
          console.log(`Login WebSocket réussi pour ${username}.`);
        }
        break;
      case "error":
        alert("Erreur serveur: " + data.message);
        console.error("Erreur WebSocket du serveur:", data.message);
        break;
      default:
        console.log("Message WebSocket inconnu:", data);
    }
  };
 
  ws.onerror = (error) => {
    console.error("WebSocket erreur:", error);
    alert("Erreur WebSocket. Veuillez recharger la page.");
  };
 
  ws.onclose = () => {
    console.log("Connexion WebSocket fermée.");
    const statusDiv = document.getElementById("status");
    if (statusDiv) {
      statusDiv.textContent = "Connexion perdue.";
      statusDiv.style.color = "red";
    }
  };
}

// Met à jour la liste des utilisateurs disponibles (hors soi-même)
function updateUserList(users) {
  // Pour la page d'index (si elle affiche une liste d'utilisateurs)
  const list = document.getElementById("user-list");
  if (list) {
    list.innerHTML = "";
    users.forEach(user => {
      if (user !== currentUser) {
        const li = document.createElement("li");
        li.textContent = user;
        li.style.cursor = "pointer";
        li.onclick = () => {
          targetUser = user;
          const targetNameDisplay = document.getElementById("target-name");
          const callSection = document.getElementById("call-section");
          if (targetNameDisplay) targetNameDisplay.textContent = targetUser;
          if (callSection) callSection.style.display = "block";
        };
        list.appendChild(li);
      }
    });
  }

  // Pour la page d'appel (liste déroulante)
  const usersSelect = document.getElementById('usersSelect');
  if (usersSelect) {
    usersSelect.innerHTML = '';
    users.filter(u => u !== currentUser).forEach(u => {
      const option = document.createElement('option');
      option.value = u;
      option.text = u;
      usersSelect.appendChild(option);
    });
    const callBtn = document.getElementById('callBtn');
    if (callBtn) {
      callBtn.disabled = usersSelect.options.length === 0;
    }
  }
}

// Fonctions WebRTC (utilisées par initCallPage)
let localStream;
let remoteStream = new MediaStream();

async function setupConnection() {
  console.log("setupConnection: Initialisation de la connexion RTCPeerConnection.");
  pc = new RTCPeerConnection(config); // Utilise la config globale

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({
        type: "candidate",
        name: currentUser,
        target: targetUser,
        candidate: event.candidate
      }));
    }
  };

  pc.ontrack = (event) => {
    document.getElementById("remoteVideo").srcObject = event.streams[0];
  };

  try {
    console.log("setupConnection: Tentative d'accès à la caméra/microphone via getUserMedia...");
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (localStream) {
      console.log("setupConnection: Accès à la caméra/microphone réussi. Flux local obtenu:", localStream);
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
      const localVideoElement = document.getElementById("localVideo");
      if (localVideoElement) {
        localVideoElement.srcObject = localStream;
        console.log("Flux local assigné à #localVideo.");
      } else {
        console.error("Élément #localVideo non trouvé.");
      }
    } else {
      console.error("getUserMedia n'a pas retourné de flux.");
    }
  } catch (e) {
    console.error('setupConnection: Erreur lors de l\'accès à la caméra/microphone:', e);
    alert('Impossible d\'accéder à la caméra/microphone. Veuillez autoriser l\'accès à la caméra et au microphone dans les paramètres de votre navigateur. Erreur: ' + e.message);
  }
}

async function startCall() {
  console.log("startCall: Début de l'appel.");
  const usersSelect = document.getElementById('usersSelect');
  if (!usersSelect || !usersSelect.value) {
    alert("Veuillez sélectionner un utilisateur à appeler.");
    return;
  }
  targetUser = usersSelect.value;
  await setupConnection();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  ws.send(JSON.stringify({
    type: "offer",
    name: currentUser,
    target: targetUser,
    sdp: offer.sdp
  }));
  document.getElementById("status").textContent = `Offre envoyée à ${targetUser}`;
}

async function handleOffer(sdp) {
  console.log("handleOffer: Traitement de l'offre reçue.");
  await setupConnection();

  await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  ws.send(JSON.stringify({
    type: "answer",
    name: currentUser,
    target: targetUser,
    sdp: answer.sdp
  }));
  document.getElementById("status").textContent = `Réponse envoyée à ${targetUser}`;
}

async function handleAnswer(data) {
  await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.sdp }));
  document.getElementById("status").textContent = `Réponse reçue de ${data.name}`;
}

async function handleCandidate(data) {
  if (pc && data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      document.getElementById("status").textContent = `Candidat ICE reçu de ${data.name}`;
    } catch (e) {
      console.error('Erreur ajout candidat ICE:', e);
    }
  }
}

function handleLeave() {
  if (pc) {
    pc.close();
    pc = null;
  }
  remoteStream = new MediaStream();
  document.getElementById("remoteVideo").srcObject = remoteStream;
  document.getElementById("status").textContent = 'L\'autre utilisateur a quitté.';
}

// Fonction d'initialisation pour la page d'appel (call.html)
function initCallPage() {
  const urlParams = new URLSearchParams(window.location.search);
  currentUser = urlParams.get('user') || "Anonyme";
  document.getElementById('usernameDisplay').textContent = currentUser;

  // Assigner l'événement au clic du bouton Appeler
  const callBtn = document.getElementById('callBtn');
  if (callBtn) {
    callBtn.onclick = startCall;
  }

  openWebSocket(currentUser); // Ouvre la connexion WebSocket pour la page d'appel
  setupConnection(); // Initialise la connexion WebRTC et le flux vidéo local dès l'entrée de la page
}
 
// Met à jour la liste des utilisateurs disponibles (hors soi-même)
function updateUserList(users) {
  console.log("Mise à jour de la liste des utilisateurs:", users);
  // Pour la page d'index (si elle affiche une liste d'utilisateurs)
  const list = document.getElementById("user-list");
  if (list) {
    list.innerHTML = "";
    users.forEach(user => {
      if (user !== currentUser) {
        const li = document.createElement("li");
        li.textContent = user;
        li.style.cursor = "pointer";
        li.onclick = () => {
          targetUser = user;
          const targetNameDisplay = document.getElementById("target-name");
          const callSection = document.getElementById("call-section");
          if (targetNameDisplay) targetNameDisplay.textContent = targetUser;
          if (callSection) callSection.style.display = "block";
        };
        list.appendChild(li);
      }
    });
  }
 
  // Pour la page d'appel (liste déroulante)
  const usersSelect = document.getElementById('usersSelect');
  if (usersSelect) {
    usersSelect.innerHTML = '';
    users.filter(u => u !== currentUser).forEach(u => {
      const option = document.createElement('option');
      option.value = u;
      option.text = u;
      usersSelect.appendChild(option);
    });
    const callBtn = document.getElementById('callBtn');
    if (callBtn) {
      callBtn.disabled = usersSelect.options.length === 0;
    }
  }
}
 
// Détermine quelle fonction d'initialisation appeler en fonction de la page
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOMContentLoaded déclenché.");
  if (window.location.pathname.includes("call.html")) {
    initCallPage();
  } else if (window.location.pathname.includes("index.html") || window.location.pathname == "/" ) {
    console.log("Page index.html détectée.");
    // Assigner les fonctions aux boutons d'index.html
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) {
      console.log("Bouton 'submitBtn' trouvé.");
      try {
        submitBtn.onclick = async () => {
          console.log("Bouton 'submitBtn' cliqué.");
          const action = document.getElementById("action").value;
          console.log("Action sélectionnée:", action);
          if (action === "signup") {
            await register();
          } else if (action === "login") {
            await login();
          }
        };
      } catch (e) {
        console.error("Erreur lors de l'attachement de l'événement au bouton 'submitBtn':", e);
      }
    } else {
      console.log("Bouton 'submitBtn' non trouvé.");
    }
  }
});
