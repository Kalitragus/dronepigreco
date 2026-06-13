#!/bin/bash
# Avvia lo Studio (Drone π + Granulone) in locale e apre il browser.
# Doppio clic su questo file per partire.
cd "$(dirname "$0")" || { echo "ERRORE: cartella del progetto non trovata."; read -r; exit 1; }
PORT=8765
URL="http://localhost:$PORT/studio.html"

# Se un vecchio server è rimasto acceso sulla porta, lo chiude prima di ripartire.
OLD=$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null)
if [ -n "$OLD" ]; then
  echo "Trovato un vecchio server ancora attivo: lo chiudo e riparto..."
  kill $OLD 2>/dev/null
  sleep 1
fi

# Apre il browser dopo un attimo, mentre il server parte.
(sleep 1 && open "$URL") &

echo "Studio attivo su $URL"
echo "Lascia aperta questa finestra. Per chiudere: Ctrl+C o chiudi la finestra."
python3 -m http.server "$PORT"
STATUS=$?

# Se il server si è fermato con un errore, tiene la finestra aperta per leggerlo.
if [ "$STATUS" -ne 0 ]; then
  echo ""
  echo "ERRORE: il server si è fermato (codice $STATUS). Leggi il messaggio qui sopra."
  echo "Premi Invio per chiudere questa finestra."
  read -r
fi
