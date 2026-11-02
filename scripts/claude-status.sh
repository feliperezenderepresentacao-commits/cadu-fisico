#!/bin/bash
# Avisa o celular do Felipe (Cadu físico) sobre o andamento de uma conversa com o Claude.
# Uso: claude-status.sh <nome-da-conversa> <executando|esperando|terminou> "título curto"
# Grava sessoes/<nome>.json no ramo "status" do repositório cadu-fisico (o agente do PC lê a cada 15 s).
set -e
NOME=$(echo "${1:-conversa}" | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g' | cut -c1-40)
ESTADO="$2"; TITULO="$3"
REPO_URL="${CADU_STATUS_REPO:-https://github.com/feliperezenderepresentacao-commits/cadu-fisico.git}"
DIR="${CADU_STATUS_DIR:-$HOME/.cadu-status}"
if [ ! -d "$DIR/.git" ]; then
  git clone -q --depth 1 --branch status "$REPO_URL" "$DIR"
fi
cd "$DIR"
git fetch -q --depth 1 origin +status:refs/remotes/origin/status && git reset -q --hard origin/status
mkdir -p sessoes
python3 -c "import json,sys,time;json.dump({'estado':sys.argv[1],'titulo':sys.argv[2],'quando':int(time.time())},open(sys.argv[3],'w'),ensure_ascii=False)" "$ESTADO" "$TITULO" "sessoes/$NOME.json"
# limpa conversas paradas há mais de 2 dias
find sessoes -name '*.json' -mtime +2 -delete 2>/dev/null || true
git add -A sessoes
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -qm "status $NOME: $ESTADO — $TITULO${CADU_STATUS_TRAILER:+

$CADU_STATUS_TRAILER}" || exit 0
for i in 1 2 3; do git push -q origin status 2>/dev/null && exit 0; git fetch -q --depth 1 origin +status:refs/remotes/origin/status && git rebase -q origin/status || true; done
echo "não consegui enviar o status" >&2
