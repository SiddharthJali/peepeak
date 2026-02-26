from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional
import uvicorn
from database import init_db, get_db
from auth import (
    get_password_hash, 
    verify_password, 
    create_access_token, 
    get_current_user_id,
    User, 
    UserCreate, 
    UserLogin, 
    Token
)
import os

app = FastAPI(title="Peak Pee API")

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database
init_db()

# Pydantic models
class LocationCreate(BaseModel):
    latitude: float
    longitude: float
    altitude: Optional[float] = None
    note: Optional[str] = None

class LocationResponse(BaseModel):
    id: int
    latitude: float
    longitude: float
    altitude: Optional[float]
    note: Optional[str]
    timestamp: str
    
    class Config:
        from_attributes = True

class StatsResponse(BaseModel):
    total_points: int
    highest_altitude: Optional[float]
    lowest_altitude: Optional[float]
    average_altitude: Optional[float]
    total_distance_km: Optional[float]

# API Endpoints

# ============ AUTH ENDPOINTS ============

@app.post("/api/auth/register", response_model=Token)
async def register(user_data: UserCreate):
    """Register a new user"""
    db = get_db()
    cursor = db.cursor()
    
    # Check if email already exists
    cursor.execute("SELECT id FROM users WHERE email = ?", (user_data.email,))
    if cursor.fetchone():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Check if username already exists
    cursor.execute("SELECT id FROM users WHERE username = ?", (user_data.username,))
    if cursor.fetchone():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )
    
    # Create user
    hashed_password = get_password_hash(user_data.password)
    created_at = datetime.now().isoformat()
    
    cursor.execute(
        """
        INSERT INTO users (username, email, hashed_password, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (user_data.username, user_data.email, hashed_password, created_at)
    )
    db.commit()
    
    user_id = cursor.lastrowid
    
    # Create access token
    access_token = create_access_token(data={"sub": user_id})
    
    return Token(access_token=access_token, token_type="bearer")

@app.post("/api/auth/login", response_model=Token)
async def login(user_data: UserLogin):
    """Login user"""
    db = get_db()
    cursor = db.cursor()
    
    # Find user by email
    cursor.execute(
        "SELECT id, hashed_password FROM users WHERE email = ?",
        (user_data.email,)
    )
    user = cursor.fetchone()
    
    if not user or not verify_password(user_data.password, user[1]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )
    
    # Create access token
    access_token = create_access_token(data={"sub": user[0]})
    
    return Token(access_token=access_token, token_type="bearer")

@app.get("/api/auth/me", response_model=User)
async def get_current_user(user_id: int = Depends(get_current_user_id)):
    """Get current user info"""
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute(
        "SELECT id, username, email, created_at FROM users WHERE id = ?",
        (user_id,)
    )
    user = cursor.fetchone()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return User(
        id=user[0],
        username=user[1],
        email=user[2],
        created_at=user[3]
    )

# ============ LOCATION ENDPOINTS ============

@app.post("/api/locations", response_model=LocationResponse)
async def save_location(location: LocationCreate, user_id: int = Depends(get_current_user_id)):
    """Save a new location point (requires authentication)"""
    db = get_db()
    cursor = db.cursor()
    
    timestamp = datetime.now().isoformat()
    
    cursor.execute(
        """
        INSERT INTO locations (user_id, latitude, longitude, altitude, note, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, location.latitude, location.longitude, location.altitude, location.note, timestamp)
    )
    db.commit()
    
    location_id = cursor.lastrowid
    
    cursor.execute("SELECT * FROM locations WHERE id = ?", (location_id,))
    row = cursor.fetchone()
    
    return LocationResponse(
        id=row[0],
        latitude=row[2],
        longitude=row[3],
        altitude=row[4],
        note=row[5],
        timestamp=row[6]
    )

@app.get("/api/locations", response_model=List[LocationResponse])
async def get_locations(user_id: int = Depends(get_current_user_id), limit: int = 100):
    """Get all saved locations for the authenticated user"""
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute(
        "SELECT * FROM locations WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?",
        (user_id, limit)
    )
    rows = cursor.fetchall()
    
    return [
        LocationResponse(
            id=row[0],
            latitude=row[2],
            longitude=row[3],
            altitude=row[4],
            note=row[5],
            timestamp=row[6]
        )
        for row in rows
    ]

@app.get("/api/stats", response_model=StatsResponse)
async def get_stats(user_id: int = Depends(get_current_user_id)):
    """Get statistics about saved locations for the authenticated user"""
    db = get_db()
    cursor = db.cursor()
    
    # Total count
    cursor.execute("SELECT COUNT(*) FROM locations WHERE user_id = ?", (user_id,))
    total = cursor.fetchone()[0]
    
    # Altitude stats
    cursor.execute("""
        SELECT 
            MAX(altitude) as highest,
            MIN(altitude) as lowest,
            AVG(altitude) as average
        FROM locations
        WHERE altitude IS NOT NULL AND user_id = ?
    """, (user_id,))
    altitude_stats = cursor.fetchone()
    
    # Simple distance calculation (sum of distances between consecutive points)
    cursor.execute("""
        SELECT latitude, longitude FROM locations 
        WHERE user_id = ?
        ORDER BY timestamp ASC
    """, (user_id,))
    points = cursor.fetchall()
    
    total_distance = 0
    if len(points) > 1:
        from math import radians, sin, cos, sqrt, atan2
        
        def haversine(lat1, lon1, lat2, lon2):
            R = 6371  # Earth's radius in km
            dlat = radians(lat2 - lat1)
            dlon = radians(lon2 - lon1)
            a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)**2
            c = 2 * atan2(sqrt(a), sqrt(1-a))
            return R * c
        
        for i in range(len(points) - 1):
            total_distance += haversine(
                points[i][0], points[i][1],
                points[i+1][0], points[i+1][1]
            )
    
    return StatsResponse(
        total_points=total,
        highest_altitude=altitude_stats[0],
        lowest_altitude=altitude_stats[1],
        average_altitude=altitude_stats[2],
        total_distance_km=round(total_distance, 2) if total_distance > 0 else None
    )

@app.delete("/api/locations/{location_id}")
async def delete_location(location_id: int, user_id: int = Depends(get_current_user_id)):
    """Delete a specific location (only if owned by user)"""
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute("DELETE FROM locations WHERE id = ? AND user_id = ?", (location_id, user_id))
    db.commit()
    
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Location not found or not owned by user")
    
    return {"message": "Location deleted successfully"}

@app.delete("/api/locations")
async def delete_all_locations(user_id: int = Depends(get_current_user_id)):
    """Delete all locations for the authenticated user"""
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute("DELETE FROM locations WHERE user_id = ?", (user_id,))
    db.commit()
    
    return {"message": f"Deleted {cursor.rowcount} locations"}

# Serve frontend
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "..", "static")), name="static")

@app.get("/")
async def serve_frontend():
    return FileResponse(os.path.join(frontend_path, "index.html"))

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
