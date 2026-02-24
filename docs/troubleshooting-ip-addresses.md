# Troubleshooting: IP Addresses Showing as "-"

## Problem

VM/container IP addresses show as "-" in the Overview and Guest Detail pages even though systems are running and have network connectivity.

## Root Cause

The Proxmox Center app retrieves IP addresses through different mechanisms:

### For QEMU VMs
- Requires **QEMU guest agent** to be installed inside the VM
- Requires API user/token to have **`VM.GuestAgent.Audit`** permission
- Without either of these, IP addresses cannot be retrieved

### For LXC Containers  
- Uses Proxmox's native container interface API
- Does not require guest agent
- Should work with standard permissions

## Solution

### Step 1: Grant Guest Agent API Permission

SSH to your Proxmox server as root and run **ONE** of these commands:

**Option A - Update existing custom role** (recommended if you created `ProxmoxCenterRole`):
```bash
pveum role modify ProxmoxCenterRole -privs "VM.Audit VM.Allocate VM.PowerMgmt VM.Config.CPU VM.Config.Memory VM.Config.Network VM.Config.Options VM.Config.Disk VM.Config.HWType VM.Clone VM.Snapshot VM.GuestAgent.Audit Datastore.Audit Datastore.AllocateSpace Datastore.AllocateTemplate Sys.Audit Pool.Audit SDN.Use"
```

**Option B - Grant PVEVMUser role** (quick fix, includes guest agent access):
```bash
pveum aclmod / -user proxmox-center@pve -role PVEVMUser
```

**Option C - Grant PVEVMAdmin role** (for testing only, full VM admin):
```bash
pveum aclmod / -user proxmox-center@pve -role PVEVMAdmin
```

### Step 2: Install QEMU Guest Agent in VMs

The guest agent must be installed **inside each VM**:

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install qemu-guest-agent
sudo systemctl start qemu-guest-agent
sudo systemctl enable qemu-guest-agent
```

**CentOS/RHEL/Rocky/Alma:**
```bash
sudo yum install qemu-guest-agent
sudo systemctl start qemu-guest-agent
sudo systemctl enable qemu-guest-agent
```

**Windows:**
- Download and install virtio-win-guest-tools from the Proxmox ISO
- Or download from: https://github.com/virtio-win/virtio-win-pkg-scripts/blob/master/README.md

**Arch Linux:**
```bash
sudo pacman -S qemu-guest-agent
sudo systemctl start qemu-guest-agent
sudo systemctl enable qemu-guest-agent
```

### Step 3: Enable Guest Agent in VM Config (Proxmox UI)

1. Select the VM in Proxmox UI
2. Go to **Options**
3. Double-click **QEMU Guest Agent**
4. Check **Use QEMU Guest Agent**
5. Click **OK**
6. **Restart the VM** for changes to take effect

Or via command line on Proxmox host:
```bash
qm set <vmid> --agent 1
```

### Step 4: Verify

After completing the above steps:

1. Wait 10-15 seconds for guest agent to initialize
2. Refresh the Proxmox Center web UI
3. IP addresses should now appear in the "Assigned IP" column

## Verification Commands

**Check if guest agent is running in VM:**
```bash
# On Linux VMs
systemctl status qemu-guest-agent

# On Windows VMs (PowerShell as admin)
Get-Service QEMU-GA
```

**Check if Proxmox sees the guest agent:**
```bash
# On Proxmox host
qm agent <vmid> ping
qm agent <vmid> network-get-interfaces
```

**Check API permissions:**
```bash
# On Proxmox host
pveum role show ProxmoxCenterRole
pveum acl list | grep proxmox-center
```

## Still Not Working?

1. **Restart the VM** after installing guest agent
2. Verify agent checkbox is enabled in VM Options
3. Check VM has `agent: enabled` in config: `qm config <vmid>`
4. Verify network connectivity in the VM
5. Check Proxmox logs: `/var/log/pve/tasks/`

## LXC Containers

LXC containers should show IPs without any additional setup. If they don't:
- Verify the container has network configured
- Check container is running: `pct status <ctid>`
- Verify API permissions include basic read access
