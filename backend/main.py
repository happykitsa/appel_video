from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import sqlite3
import os
import json

app = FastAPI()
# Dictionnaire pour stocker les connexions des utilisateurs connectés {username: websocket}
clients = {}

async def broadcast_user_list():
    """
    Envoie à tous les clients la liste actuelle des utilisateurs connectés.
    """
    users = list(clients.keys())
    message = json.dumps({"type": "user_list", "users": users})
    for ws in clients.values():
        try:
            await ws.send(message)
        except:
            pass  # On ignore les erreurs ici pour éviter de bloquer tout le serveur

# Middleware CORS pour autoriser l'accès au frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Définir le chemin absolu vers le frontend
frontend_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend')
app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

# Chemin absolu vers la base de données
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "database.db")

@app.get("/", response_class=HTMLResponse)
def read_index():
    with open(os.path.join(frontend_dir, "index.html"), encoding="utf-8") as f:
        return f.read()

@app.post("/api/register")
async def register_user(request: Request):
    data = await request.json()
    username = data.get("username")

    if not username:
        return {"success": False, "message": "Nom requis"}

    try:
        conn = sqlite3.connect(DB_PATH, timeout=10)
        c = conn.cursor()
        c.execute("INSERT INTO utilisateurs (nom_utilisateur) VALUES (?)", (username,))
        conn.commit()
        conn.close()
        return {"success": True}
    except sqlite3.IntegrityError:
        return {"success": False, "message": "Nom déjà pris"}

@app.get("/api/login")
async def login_user(username: str):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT * FROM utilisateurs WHERE nom_utilisateur = ?", (username,))
    result = c.fetchone()
    conn.close()

    if result:
        return {"success": True}
    else:
        return {"success": False, "message": "Utilisateur non trouvé"}





@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, username: str):
    await websocket.accept()
    clients[username] = websocket
    print(f"{username} connecté via WebSocket.")
    await broadcast_user_list()

    try:
        while True:
            message = await websocket.receive_text()
            data = json.loads(message)
            target = data.get("target")

            if target in clients:
                await clients[target].send_text(json.dumps(data))
                print(f"Message envoyé de {data['name']} à {target}: {data['type']}")
            else:
                await websocket.send_text(json.dumps({"type": "error", "message": "Utilisateur cible non connecté"}))
    except WebSocketDisconnect:
        for user, ws_conn in list(clients.items()):
            if ws_conn == websocket:
                print(f"{user} déconnecté du WebSocket.")
                del clients[user]
                break
        await broadcast_user_list()
