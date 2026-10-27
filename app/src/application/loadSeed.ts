import rawSeed from '../data/us-curtain.seed.json';
import { validateProject } from '../domain/validation';

export function loadSeed() { return validateProject(rawSeed); }
