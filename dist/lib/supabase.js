"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = exports.isSupabaseConfigured = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || '';
if (!supabaseUrl || !supabaseServiceKey) {
    console.warn('⚠️  SUPABASE_URL or SUPABASE_SERVICE_KEY is not set. Running in local-only mode.');
}
exports.isSupabaseConfigured = Boolean(supabaseUrl && supabaseServiceKey);
exports.supabase = exports.isSupabaseConfigured
    ? (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    })
    : null;
