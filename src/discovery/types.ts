export type DiscoveryAnswer = {
  id: string;
  question: string;
  answer: string;
  isCustom: boolean;
};

export type DiscoveryEntryInput = {
  clinicName: string;
  contactName?: string;
  contactPhone?: string;
  notes?: string;
  answers: DiscoveryAnswer[];
};

export type DiscoveryEntry = DiscoveryEntryInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
