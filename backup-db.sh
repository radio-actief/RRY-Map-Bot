#!/bin/bash
# Database Backup Script for RRY-Map-Bot
# Run this script via cron for automated backups

BACKUP_DIR="./backups"
DATA_DIR="./data"
DB_FILE="$DATA_DIR/belgian_nodes.db"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/belgian_nodes_$DATE.db"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Check if database exists
if [ ! -f "$DB_FILE" ]; then
    echo "ERROR: Database file not found at $DB_FILE"
    exit 1
fi

# Create backup
cp "$DB_FILE" "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "✓ Backup created: $BACKUP_FILE"
    
    # Compress backup (optional, saves space)
    gzip "$BACKUP_FILE"
    echo "✓ Backup compressed: $BACKUP_FILE.gz"
    
    # Keep only last 30 days of backups
    find "$BACKUP_DIR" -name "belgian_nodes_*.db.gz" -mtime +30 -delete
    echo "✓ Old backups cleaned (kept last 30 days)"
    
    # List recent backups
    echo ""
    echo "Recent backups:"
    ls -lh "$BACKUP_DIR" | tail -5
else
    echo "ERROR: Backup failed"
    exit 1
fi

