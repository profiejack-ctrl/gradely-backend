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
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
// Security and utility middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: FRONTEND_URL,
    credentials: true,
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
// Start server
app.listen(PORT, () => {
    console.log(`🚀 SMS Backend running on http://localhost:${PORT}`);
    console.log(`📡 Supabase: ${supabase_1.isSupabaseConfigured ? 'configured' : 'not configured'}`);
});
exports.default = app;
