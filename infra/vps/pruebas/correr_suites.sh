#!/bin/bash
# Corre las suites contra la base <proyecto> (argumento). Cada suite termina en excepción y se revierte.
set -u
P="${1:?uso: correr_suites.sh <proyecto>}"
S=/tmp/plantilla/pruebas
R=$(mktemp -d)
sed -i 's/\r$//' /tmp/plantilla/fixture.sql
runuser -u postgres -- psql -X -p 5433 -d $P -f - < /tmp/plantilla/fixture.sql 2>&1 | grep -vE '^(BEGIN|COMMIT|DO|$)|set_config|^-+\+|^ *\| *$|\(1 row\)' | cut -c1-200

antes=$(runuser -u postgres -- psql -X -At -p 5433 -d $P -c "select (select count(*) from public.ventas)||'/'||(select count(*) from public.productos)||'/'||(select count(*) from public.profiles)")
for f in "$S"/*.sql; do
  n=$(basename "$f" .sql)
  sed -e 's/\r$//' -e 's/{{USUARIO_TIENDA}}/tienda@prueba.invalid/g' -e 's/{{USUARIO_ADMIN}}/admin@prueba.invalid/g' "$f" > "$R/$n.sql"
  runuser -u postgres -- psql -X -q -p 5433 -d $P -v ON_ERROR_STOP=1 --single-transaction -f - < "$R/$n.sql" > "$R/$n.out" 2>&1
done
despues=$(runuser -u postgres -- psql -X -At -p 5433 -d $P -c "select (select count(*) from public.ventas)||'/'||(select count(*) from public.productos)||'/'||(select count(*) from public.profiles)")

python3 -I - "$R" <<'PY'
import glob, json, os, re, sys
total = ok = rev = mal = 0
for out in sorted(glob.glob(os.path.join(sys.argv[1], '*.out'))):
    n = os.path.basename(out)[:-4]
    t = open(out, encoding='utf8', errors='replace').read()
    m = re.search(r'RESULTADOS (\[.*\])', t, re.S)
    if not m:
        err = [l for l in t.splitlines() if 'ERROR' in l][:2]
        print(f'SIN RESULTADO {n}: ' + ' / '.join(e[:220] for e in err)); continue
    try:
        filas, _ = json.JSONDecoder().raw_decode(m.group(1))
    except Exception as e:
        print(f'JSON ilegible {n}: {e}'); continue
    def clase(s):
        p = str(s or '').split()
        if not p: return ''
        return 'OK' if p[0] == 'OK' else 'ERROR ' + (p[1].rstrip(':') if len(p) > 1 else '')
    exactas, redaccion, malas = 0, [], []
    for f in filas:
        e, o = str(f.get('esperado') or ''), str(f.get('obtenido') or '')
        if o.startswith(e): exactas += 1
        elif clase(e) == clase(o): redaccion.append(f)
        else: malas.append(f)
    total += len(filas); ok += exactas; rev += len(redaccion); mal += len(malas)
    print(f'{n}: exactas {exactas}, misma clase {len(redaccion)}, FALLAN {len(malas)} de {len(filas)}')
    for f in malas:
        print(f"   X {f['caso'][:90]}\n     esperado: {str(f['esperado'])[:120]}\n     obtenido: {str(f['obtenido'])[:170]}")
    for f in redaccion:
        print(f"   ~ {f['caso'][:62]} | esp: {str(f['esperado'])[:62]} | obt: {str(f['obtenido'])[:88]}")
print(f'TOTAL {total}: exactas {ok}, misma clase {rev}, fallan {mal}')
PY
echo "filas ventas/productos/perfiles antes=$antes despues=$despues"
rm -rf "$R"
