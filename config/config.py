# RRY-Map-Bot Configuration
# Loads environment variables and provides configuration access

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Discord Bot Configuration
DISCORD_BOT_TOKEN = os.getenv('DISCORD_BOT_TOKEN')
DISCORD_GUILD_ID = os.getenv('DISCORD_GUILD_ID')
STARTUP_CHANNEL_ID = os.getenv('STARTUP_CHANNEL_ID')
STARTUP_MESSAGE_ID = os.getenv('STARTUP_MESSAGE_ID')

# Database Configuration
DATABASE_PATH = os.getenv('DATABASE_PATH', 'data/belgian_nodes.db')

# Geopy Configuration
GEOPY_USER_AGENT = os.getenv('GEOPY_USER_AGENT', 'belgian_meshcore_map')
GEOPY_TIMEOUT = int(os.getenv('GEOPY_TIMEOUT', '10'))

# API Configuration
OFFICIAL_API_URL = os.getenv('OFFICIAL_API_URL', 'https://map.meshcore.dev/api/v1/nodes')
LOCAL_API_URL = os.getenv('LOCAL_API_URL', 'http://localhost:8000/api/v1')

# Sync Configuration
SYNC_INTERVAL_HOURS = int(os.getenv('SYNC_INTERVAL_HOURS', '6'))

# Belgian Geographic Bounds
BELGIUM_BOUNDS = {
    'min_lat': 49.5,
    'max_lat': 51.5,
    'min_lon': 2.5,
    'max_lon': 6.4
}

# Node Type Mapping
NODE_TYPES = {
    1: "companion",
    2: "repeater",
    3: "room server",
    4: "sensor"
}

NODE_TYPES_REVERSE = {v.lower(): k for k, v in NODE_TYPES.items()}

# Node Type Icons for Discord
NODE_TYPE_ICONS = {
    1: "📱",  # companion
    2: "📡",  # repeater
    3: "💾",  # room server
    4: "🌡️"   # sensor
}

# Frequency Presets
FREQUENCY_PRESETS = [
    {"name": "Australia", "freq": 915.800, "sf": 10, "bw": 250, "cr": 5},
    {"name": "Australia: Victoria", "freq": 916.675, "sf": 7, "bw": 62.5, "cr": 8},
    {"name": "EU/UK (Narrow)", "freq": 869.618, "sf": 8, "bw": 62.5, "cr": 8},
    {"name": "EU/UK (Long Range)", "freq": 869.525, "sf": 11, "bw": 250, "cr": 5},
    {"name": "EU/UK (Medium Range)", "freq": 869.525, "sf": 10, "bw": 250, "cr": 5},
    {"name": "Czech Republic (Narrow)", "freq": 869.525, "sf": 7, "bw": 62.5, "cr": 5},
    {"name": "EU 433MHz (Long Range)", "freq": 433.650, "sf": 11, "bw": 250, "cr": 5},
    {"name": "New Zealand", "freq": 917.375, "sf": 11, "bw": 250, "cr": 5},
    {"name": "New Zealand (Narrow)", "freq": 917.375, "sf": 7, "bw": 62.5, "cr": 5},
    {"name": "Portugal 433", "freq": 433.375, "sf": 9, "bw": 62.5, "cr": 6},
    {"name": "Portugal 868", "freq": 869.618, "sf": 7, "bw": 62.5, "cr": 6},
    {"name": "USA/Canada (Recommended)", "freq": 910.525, "sf": 7, "bw": 62.5, "cr": 5},
    {"name": "Vietnam", "freq": 920.250, "sf": 11, "bw": 250, "cr": 5},
]

