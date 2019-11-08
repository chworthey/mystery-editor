export interface MysterySchema {
  FinalGoalId:           string;
  InitialInteractableId: string;
  Interactables:         Interactable[];
  Keys?:                 Key[];
}

export interface Interactable {
  ComplexityScore?:        number;
  Description?:            string;
  Id:                      string;
  KeysRequired?:           string[];
  OnInteractionCompletion?: string[];
}

export interface Key {
  Description?: string;
  Id:           string;
}
