#!/usr/bin/env bash
# Usage: sudo bash lazeika-only-node-setup.sh <managed-inbound-port> [speed-mbit]
set -euo pipefail

PORT=${1:?Укажите порт managed inbound из панели Remnawave}
SPEED=${2:-5}
IFACE=ens3

[[ $PORT =~ ^[0-9]+$ && $PORT -ge 1 && $PORT -le 65535 ]] || { echo 'Некорректный порт'; exit 2; }
[[ $SPEED =~ ^[0-9]+$ && $SPEED -ge 1 && $SPEED -le 1000 ]] || { echo 'Некорректная скорость'; exit 2; }
command -v tc >/dev/null || { echo 'Установите iproute2: apt-get update && apt-get install -y iproute2'; exit 3; }

install -d /usr/local/sbin
cat >/usr/local/sbin/lazeika-only-tc <<EOF
#!/usr/bin/env bash
set -euo pipefail
IFACE=$IFACE
PORT=$PORT
tc qdisc show dev "\$IFACE" | grep -q clsact || tc qdisc add dev "\$IFACE" clsact
for dir in ingress egress; do for pref in {11000..11007}; do tc filter del dev "\$IFACE" "\$dir" pref "\$pref" 2>/dev/null || true; done; done
tc action del action police index 45101 2>/dev/null || true
tc action del action police index 45102 2>/dev/null || true
tc actions replace action police rate ${SPEED}mbit burst 256kb drop index 45101
tc actions replace action police rate ${SPEED}mbit burst 256kb drop index 45102
pref=11000
for proto in ip ipv6; do for dir in ingress egress; do for l4 in tcp udp; do
  match=dst_port; index=45101; [ "\$dir" = egress ] && { match=src_port; index=45102; }
  tc filter replace dev "\$IFACE" "\$dir" pref "\$pref" protocol "\$proto" flower ip_proto "\$l4" "\$match" "\$PORT" action police index "\$index"
  pref=\$((pref+1))
done; done; done
EOF
chmod 0755 /usr/local/sbin/lazeika-only-tc
cat >/etc/systemd/system/lazeika-only-tc.service <<'EOF'
[Unit]
Description=Lazeika-Only aggregate traffic limiter
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/lazeika-only-tc
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now lazeika-only-tc.service
echo "OK: ens3, port $PORT, aggregate limit ${SPEED} Mbit/s"
