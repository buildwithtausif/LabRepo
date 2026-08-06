export interface SecurityConfig {
  maxUploadBytes: number;
  maxStoragePerUserBytes: number;
  loginRateLimit: number;
  uploadRateLimit: number;
  maxRepositories: number;
  allowedExtensions: string[];
}

const DEFAULT_ALLOWED_EXTENSIONS = [
  'py', 'ipynb', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'c', 'cpp', 'h', 'hpp', 'java', 'kt', 'cs',
  'go', 'rs', 'swift', 'php', 'rb', 'r', 'scala', 'sql', 'html', 'css',
  'scss', 'json', 'yaml', 'yml', 'xml', 'md', 'txt', 'csv', 'parquet',
  'feather', 'pkl', 'joblib', 'onnx', 'pt', 'pth', 'keras', 'h5',
  'env', 'sh', 'bat', 'ps1', 'toml', 'ini', 'cfg', 'conf', 'log', 'dockerfile',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'tex',
];

function parseNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseListEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;

  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function getSecurityConfig(): SecurityConfig {
  return {
    maxUploadBytes: parseNumberEnv('MAX_UPLOAD_SIZE', 25 * 1024 * 1024),
    maxStoragePerUserBytes: parseNumberEnv('MAX_STORAGE_PER_USER', 100 * 1024 * 1024),
    loginRateLimit: parseNumberEnv('LOGIN_RATE_LIMIT', 10),
    uploadRateLimit: parseNumberEnv('UPLOADS_PER_MINUTE', 20),
    maxRepositories: parseNumberEnv('MAX_REPOSITORIES', 50),
    allowedExtensions: parseListEnv('ALLOWED_FILE_TYPES', DEFAULT_ALLOWED_EXTENSIONS),
  };
}
