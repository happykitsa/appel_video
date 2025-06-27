import asyncio
import websockets
import json

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

async def handler(websocket):
    """
    Gère chaque client qui se connecte.
    """
    try:
        # 1) Premier message attendu : identification du client (ex: {"type": "login", "name": "Alice"})
        message = await websocket.recv()
        data = json.loads(message)

        if data["type"] == "login":
            username = data["name"]
            clients[username] = websocket
            print(f"{username} connecté.")
            await websocket.send(json.dumps({"type": "login", "success": True}))
            await broadcast_user_list()

        # 2) Ensuite le client peut envoyer des messages "offer", "answer", "candidate" à d'autres utilisateurs
        async for message in websocket:
            data = json.loads(message)
            target = data.get("target")  # utilisateur cible

            if target in clients:
                # Transfert du message au destinataire
                await clients[target].send(json.dumps(data))
                print(f"Message envoyé de {data['name']} à {target}: {data['type']}")
            else:
                # Envoie erreur si destinataire inconnu
                await websocket.send(json.dumps({"type": "error", "message": "Utilisateur cible non connecté"}))

    except websockets.exceptions.ConnectionClosed:
        # Quand un client se déconnecte, on nettoie
        for user, ws in list(clients.items()):
            if ws == websocket:
                print(f"{user} déconnecté.")
                del clients[user]
                break
        await broadcast_user_list()  # Met à jour les utilisateurs restants

async def main():
    print("Serveur de signalisation démarré sur le port 8765...")
    async with websockets.serve(handler, "0.0.0.0", 8765):
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main())
