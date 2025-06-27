let ws;                 // Connexion WebSocket globale
let currentUser = null; // Nom utilisateur courant
let targetUser = null;  // Cible de l'appel WebRTC
let pc;                 // RTCPeerConnection WebRTC

// Configuration serveur STUN Google (pour NAT traversal)
const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// Fonction pour enregistrer un utilisateur via l'API backend
async function register() {
  const username = document.getElementById("username").value.trim();
  if (!username) {
    alert("Veuillez entrer un nom d'utilisateur.");
    return;
  }

  try {
    const res = await fetch("http://DESKTOP-L05GD3B:8000/api/register", {  // Note : /api/register
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username })
    });

    const data = await res.json();

    if (data.success) {
      currentUser = username;
      document.getElementById("status").textContent = "Inscription réussie. Connexion WebSocket...";
      document.getElementById("status").style.color = "green";
      openWebSocket(); // ouvre la connexion WebSocket et s'identifie
    } else {
      alert(data.message); // nom déjà pris ou autre erreur
    }
  } catch (error) {
    console.error("Erreur lors de l'inscription:", error);
    alert("Erreur serveur. Veuillez réessayer.");
  }
}

// Ouvre la connexion WebSocket vers le serveur de signalisation
function openWebSocket() {
  ws = new WebSocket("ws://DESKTOP-L05GD3B:8765");


  ws.onopen = () => {
    // Envoi du message login dès la connexion établie
    ws.send(JSON.stringify({ type: "login", name: currentUser }));
  };

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case "user_list":
        updateUserList(data.users);
        break;
      case "offer":
        targetUser = data.name;
        document.getElementById("target-name").textContent = targetUser;
        document.getElementById("call-section").style.display = "block";
        await handleOffer(data.sdp);
        break;
      case "answer":
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.sdp }));
        break;
      case "candidate":
        if (data.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
        break;
      case "login":
        if (data.success) {
          document.getElementById("status").textContent = `Connecté en tant que ${currentUser}`;
          document.getElementById("status").style.color = "green";
        }
        break;
      case "error":
        alert("Erreur serveur: " + data.message);
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
    document.getElementById("status").textContent = "Connexion perdue.";
    document.getElementById("status").style.color = "red";
  };
}

// Met à jour la liste des utilisateurs disponibles (hors soi-même)
function updateUserList(users) {
  const list = document.getElementById("user-list");
  list.innerHTML = ""; // vide la liste avant ajout

  users.forEach(user => {
    if (user !== currentUser) {
      const li = document.createElement("li");
      li.textContent = user;
      li.style.cursor = "pointer";
      li.onclick = () => {
        targetUser = user;
        document.getElementById("target-name").textContent = targetUser;
        document.getElementById("call-section").style.display = "block";
      };
      list.appendChild(li);
    }
  });
}

// Initialise la connexion WebRTC : caméra, micro, ICE
async function setupConnection() {
  pc = new RTCPeerConnection(config);

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

  // Demande accès caméra et micro, et envoie les pistes à la connexion
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  stream.getTracks().forEach(track => pc.addTrack(track, stream));
  document.getElementById("localVideo").srcObject = stream;
}

// Démarre un appel en tant qu’initiateur
async function startCall() {
  if (!targetUser) {
    alert("Veuillez sélectionner un utilisateur à appeler.");
    return;
  }
  await setupConnection();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  ws.send(JSON.stringify({
    type: "offer",
    name: currentUser,
    target: targetUser,
    sdp: offer.sdp
  }));
}

// Traite une offre reçue
async function handleOffer(sdp) {
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
}

