"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const data_routes_1 = __importDefault(require("./routes/data.routes"));
const teachers_routes_1 = __importDefault(require("./routes/teachers.routes"));
const audit_routes_1 = __importDefault(require("./routes/audit.routes"));
const error_1 = require("./middleware/error");
const supabase_1 = require("./lib/supabase");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// Collect explicitly configured origins
const configuredOrigins = [process.env.ALLOWED_ORIGINS, process.env.FRONTEND_URL]
    .filter(Boolean)
    .flatMap(value => String(value).split(','))
    .map(origin => origin.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean);
const allowedOriginsSet = new Set(configuredOrigins);
// Default local origins
allowedOriginsSet.add('http://localhost:5173');
allowedOriginsSet.add('http://localhost:3000');
allowedOriginsSet.add('http://127.0.0.1:5173');
function isOriginAllowed(origin) {
    if (!origin)
        return true; // non-browser requests (Postman, server-to-server)
    const clean = origin.trim().replace(/\/+$/, '').toLowerCase();
    if (allowedOriginsSet.has(clean))
        return true;
    // Automatically allow all Vercel deployments (production, preview, staging)
    if (/^https:\/\/[a-z0-9_-]+\.vercel\.app$/.test(clean))
        return true;
    // Allow localhost & local network testing
    if (/^http:\/\/localhost(:\d+)?$/.test(clean))
        return true;
    if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(clean))
        return true;
    return false;
}
const corsOptions = {
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
            callback(null, true);
        }
        else {
            console.warn(`[cors] Rejected origin: ${origin}`);
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['Set-Cookie'],
    optionsSuccessStatus: 204,
};
// 1. CORS middleware must run before everything else
app.use((0, cors_1.default)(corsOptions));
app.options('*', (0, cors_1.default)(corsOptions));
// 2. Helmet with crossOriginResourcePolicy allowing cross-origin API calls
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json({ limit: '2mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '2mb' }));
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        supabaseConfigured: supabase_1.isSupabaseConfigured,
    });
});
// Mount API routes
app.use('/api/auth', auth_routes_1.default);
app.use('/api/data', data_routes_1.default);
app.use('/api/teachers', teachers_routes_1.default);
app.use('/api/audit', audit_routes_1.default);
// 404 handler for unknown routes
app.use((req, res) => {
    res.status(404).json({ error: `Cannot ${req.method} ${req.url}` });
});
// Centralized error handler
app.use(error_1.errorHandler);
// Start server locally. Vercel invokes the exported Express app.
if (!process.env.VERCEL)
    app.listen(PORT, () => {
        console.log(`🚀 SMS Backend running on http://localhost:${PORT}`);
        console.log(`📡 Supabase: ${supabase_1.isSupabaseConfigured ? 'configured' : 'not configured'}`);
    });
exports.default = app;
