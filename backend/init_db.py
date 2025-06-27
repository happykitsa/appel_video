import sqlite3

# Connexion à la base de données (elle sera créée si elle n'existe pas)
conn = sqlite3.connect("database.db")

c = conn.cursor()

# Création de la table 'utilisateurs' avec nom unique
c.execute("""
    CREATE TABLE IF NOT EXISTS utilisateurs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom_utilisateur TEXT UNIQUE
    )
""")

# Sauvegarde et fermeture
conn.commit()
conn.close()

print("✔️ Base de données users.db créée avec succès.")
