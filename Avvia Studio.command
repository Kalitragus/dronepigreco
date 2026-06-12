#!/bin/bash
# Avvia lo Studio (Drone π + Granulone) in locale e apre il browser.
# Doppio clic su questo file per partire.
cd "$(dirname "$0")"
PORT=8765
URL="http://localhost:$PORT/studio.html"

# Apre il browser dopo un attimo, mentre il server parte.
(sleep 1 && open "$URL") &

echo "Studio attivo su $URL"
echo "Lascia aperta questa finestra. Per chiudere: Ctrl+C o chiudi la finestra."
exec python3 -m http.server "$PORT"
