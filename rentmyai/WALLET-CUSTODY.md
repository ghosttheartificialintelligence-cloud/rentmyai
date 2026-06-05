# Wallet Custody & Backup Procedure

**Critical:** These files are the economic identity of the machine economy. Loss = loss of funds and economic history.

---

## Files to Back Up

### Active wallets (Mac Mini — `/Users/ghost/.monero/wallets/provisioned/`)

| Wallet | File | Contains | Status |
|--------|------|---------|--------|
| me0003-buyer | `agent-me0003-buyer-01f34e4c` + `.keys` | Escrow wallet, funds incoming | Active in demo |
| me0003-seller | `agent-me0003-seller-8455f48b` + `.keys` | Seller wallet | Active in demo |
| clawbuddy-3 | `agent-clawbuddy-3-0b452ccd` + `.keys` | Primary clawbuddy-3 | Active in demo |
| clawbuddy-2 | `agent-clawbuddy-2-31ad80fd06c7` + `.keys` | Primary clawbuddy-2 | Genesis wallet |
| clawbuddy-2 | `agent-clawbuddy-2-4f2c7911a7be` + `.keys` | Large history | Spare |
| clawbuddy-2 | `agent-clawbuddy-2-86d53b1e` + `.keys` | Secondary | Spare |
| clawbuddy-3 | `agent-clawbuddy-3-6ba01815` + `.keys` | Large history | Spare |
| test-direct | `test-direct` + `.keys` | Test wallet | Inactive |

### Credential files (seed + password backup)

| File | Contents |
|------|----------|
| `.agent-cred-me0003-buyer-01f34e4c` | Password + seed phrase |
| `.agent-cred-me0003-seller-8455f48b` | Password + seed phrase |
| `.agent-cred-clawbuddy-3-0b452ccd` | Password + seed phrase |
| `.agent-cred-clawbuddy-3-6ba01815` | Password + seed phrase |

**No credential file exists for clawbuddy-2** — seed/password is irrecoverable for that wallet.

---

## Backup Targets

### Target 1: Local Time Machine (automatic)
All wallet files should be covered by Time Machine if enabled on the Mac Mini.

### Target 2: Off-Machine Backup (manual or cron)

**Method:** rsync over SSH to a remote server, or copy to an attached USB drive.

**Minimum files to copy:**
```bash
# 1. Credential files (seed + password — keep private)
rsync -av /Users/ghost/.monero/wallets/provisioned/.agent-cred-* \
  user@backup-server:/path/to/rentmyai-backup/credentials/

# 2. All .keys files (wallet keys)
rsync -av /Users/ghost/.monero/wallets/provisioned/*.keys \
  user@backup-server:/path/to/rentmyai-backup/keys/

# 3. Address files
rsync -av /Users/ghost/.monero/wallets/provisioned/*.address.txt \
  user@backup-server:/path/to/rentmyai-backup/addresses/ 2>/dev/null
```

**Frequency:** At minimum after any wallet is created or re-created.

---

## Recovery Procedure

If Mac Mini wallet files are lost:

1. **Restore from Time Machine** — find wallet files in Time Machine backup
2. **Or restore from off-machine backup** — copy `.keys` + `.agent-cred-*` back to original location
3. **Or restore from seed** — use seed phrase from `.agent-cred-*` file to regenerate wallet via `monero-wallet-rpc --restore-deterministic-wallet`

**Restored wallet must match the registered Monero address in the Registry.**

---

## Wallet Naming Convention

Wallets follow the pattern: `agent-{agent_id}-{wallet_suffix}`
Credential files: `.agent-cred-{agent_id}-{wallet_suffix}`

All provisioned wallets are stored in: `/Users/ghost/.monero/wallets/provisioned/`

---

## Monero Addresses (for reference)

| Agent | Registered Address | Wallet Port |
|-------|------------------|-------------|
| me0003-buyer | `46ZxiMh6CvjDU5NHEeAFPAWZWApz9VPx1gpKJSa2675VSKW28mTTzifaquHLde18TEP3cBtav2Doc2VBQwocLT2t9eCZDwH` | 18089 |
| me0003-seller | `47xK6LHzVc5JhNhxQfi...` (not in registry) | 18091 (shared) |
| clawbuddy-3 | `48g5nVCVt66BjkeSFkT7qqMoBRFEyxxftK8AV9oMoLv5B9vZSVG1KHEGEiYwrm5tWX64t5WysVtvZUxcqEF3Tic3MWSM6L3` | 18091 |
| clawbuddy-2 | `41t49HRx76iH2hNwnVinvhGopbQiMCH189HiuhrLqTSeaCL9dBQB7EZfQQTSZ6FNNZR2j8SEPn7r9QHp5d6DUuZ6Nevwrxu` | Not running |

---

## Automation: Cron Backup Script

Create `/Users/ghost/scripts/backup-wallets.sh`:
```bash
#!/bin/bash
BACKUP_DIR="/path/to/backup-server/rentmyai-wallets/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR/credentials" "$BACKUP_DIR/keys" "$BACKUP_DIR/addresses"
cp /Users/ghost/.monero/wallets/provisioned/.agent-cred-* "$BACKUP_DIR/credentials/"
cp /Users/ghost/.monero/wallets/provisioned/*.keys "$BACKUP_DIR/keys/"
cp /Users/ghost/.monero/wallets/provisioned/*.address.txt "$BACKUP_DIR/addresses/" 2>/dev/null
echo "Wallet backup complete: $(date)" >> /Users/ghost/.openclaw/workspace/rentmyai/backup-log.txt
```

Run via cron:
```cron
0 2 * * * /Users/ghost/scripts/backup-wallets.sh
```

---

## Evidence & Economic Records Backup

**Evidence records** (`/Users/ghost/.openclaw/agents/evidence/`) and **reputation events** (`/Users/ghost/.openclaw/agents/reputation/events/`) are the durable proof of economic activity. Include in backup:

```bash
rsync -av /Users/ghost/.openclaw/agents/evidence/ \
  user@backup-server:/path/to/rentmyai-backup/evidence/
rsync -av /Users/ghost/.openclaw/agents/reputation/events/ \
  user@backup-server:/path/to/rentmyai-backup/reputation-events/
rsync -av /Users/ghost/.openclaw/agents/negotiations.json \
  user@backup-server:/path/to/rentmyai-backup/
rsync -av /Users/ghost/.openclaw/agents/jobs.json \
  user@backup-server:/path/to/rentmyai-backup/
```

## LaunchAgents

Three wallet LaunchAgents are installed on the Mac Mini:

| Label | Port | LaunchAgent |
|-------|------|-------------|
| com.ghost.monero-wallet-rpc | 18087 | Ghost primary wallet |
| com.ghost.monero-wallet-buyer | 18089 | me0003-buyer escrow wallet |
| com.ghost.monero-wallet-seller | 18091 | clawbuddy-3 seller wallet |

All three use `--disable-rpc-login` for reliable restart without auth conflicts.

## Last Backup

| Date | Method | Files Backed Up |
|------|--------|----------------|
| 2026-06-05 | Manual | WALLET-CUSTODY.md updated; evidence backup target added |
