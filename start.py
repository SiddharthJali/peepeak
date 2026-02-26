#!/usr/bin/env python3
"""
Railway entry point for Peak Breaks
"""
import os
import sys

# Add backend directory to Python path
backend_dir = os.path.join(os.path.dirname(__file__), 'backend')
sys.path.insert(0, backend_dir)

# Initialize database
try:
    from database import init_db
    init_db()
    print("Database initialized successfully")
except Exception as e:
    print(f"Database initialization warning: {e}")

# Start the application
if __name__ == "__main__":
    import uvicorn
    from main import app
    
    # Get port from environment (Railway provides this)
    port = int(os.getenv("PORT", 8000))
    
    print(f"Starting Peak Breaks on port {port}")
    
    # Run the app
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        log_level="info"
    )
