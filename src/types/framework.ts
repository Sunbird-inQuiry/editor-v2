export interface ITermAssociation {
  identifier: string;
  code: string;
  name: string;
  category: string;
  status?: string;
}

export interface ITerm {
  identifier: string;
  code: string;
  name: string;
  description?: string;
  index?: number;
  category?: string;
  status?: string;
  associations?: ITermAssociation[];
}

export interface ICategory {
  identifier: string;
  code: string;
  name: string;
  description?: string;
  /** Category order within the framework — the highest-index category is
   *  the skill-equivalent leaf (e.g. USF's Skill, or a K-12 framework's
   *  most granular category); only it may take more than one term. */
  index?: number;
  terms?: ITerm[];
}

export interface IFramework {
  identifier: string;
  code: string;
  name: string;
  type?: string;
  categories?: ICategory[];
}

export interface IFrameworkDetails {
  orgFramework?: IFramework;
  targetFrameworks?: IFramework[];
  channelFrameworks?: Array<{ identifier: string; name: string; type?: string }>;
}
