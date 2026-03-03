# 🚀 Quick Start Guide

## Start Everything with ONE Command

```powershell
npm start
```

This will start:
- ✅ **Frontend (Vite)** on port 3000
- ✅ **Backend (FastAPI/LangGraph)** on port 5001

## Access Your Application

### **Main Application URL:**
```
http://localhost:3000
```

Open this URL in your browser. The frontend will automatically proxy API requests to the backend.

## What Should Happen

1. **Terminal will show TWO processes:**
   - `[FRONTEND]` - Vite dev server (blue)
   - `[BACKEND]` - Python FastAPI server (magenta)

2. **Browser console should NOT show API errors**
   - If you see CORS or connection errors, the backend didn't start properly

3. **When you click RUN:**
   - Frontend sends request to `/api/run`
   - Vite proxy forwards it to `http://localhost:5001/api/run`
   - Backend processes the workflow
   - Results stream back to the UI

## Troubleshooting

### "Nothing happens when I click RUN"
- Check terminal - backend must show: `Uvicorn running on http://0.0.0.0:5001`
- Open browser DevTools (F12) → Network tab → See if `/api/run` request succeeds

### "Backend not starting"
1. Stop everything: `Ctrl+C`
2. Install Python deps:
   ```powershell
   .venv\Scripts\python.exe -m pip install -r mcp-server\requirements.txt
   ```
3. Restart: `npm start`

### "Port already in use"
Kill existing processes:
```powershell
# Kill frontend
Get-Process -Name node | Stop-Process -Force

# Kill backend  
Get-Process -Name python | Stop-Process -Force

# Restart
npm start
```

## Environment Variables

Create a `.env` file in the project root:
```
INTERNAL_API_KEY=your_internal_model_key
GEMINI_API_KEY=your_gemini_key
VITE_API_KEY=your_vite_key
```

## Stopping the Application

Press `Ctrl+C` once - both frontend and backend will stop automatically.

---
**Need Help?** Check [PROJECT.md](PROJECT.md) for detailed architecture docs.
