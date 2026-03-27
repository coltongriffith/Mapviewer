import { explorationTemplate1 } from "./explorationTemplate1";

export const TEMPLATES = {
  exploration_v1: explorationTemplate1,
};

export function getTemplate(id) {
  return TEMPLATES[id] || explorationTemplate1;
}

export { explorationTemplate1 };
