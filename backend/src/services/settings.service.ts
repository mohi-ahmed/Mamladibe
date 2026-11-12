import { SETTING_KEYS } from '../constants/index.js';
import { SettingModel } from '../models/index.js';
import { forbiddenError } from '../utils/errors.js';

export interface PlatformFreezeState {
  freezePosting: boolean;
  freezeComments: boolean;
}

export async function getPlatformFreezeState(): Promise<PlatformFreezeState> {
  const rows = await SettingModel.find({
    key: {
      $in: [SETTING_KEYS.FREEZE_POSTING, SETTING_KEYS.FREEZE_COMMENTS],
    },
  })
    .select('key value')
    .lean();

  let freezePosting = false;
  let freezeComments = false;

  for (const row of rows) {
    if (row.key === SETTING_KEYS.FREEZE_POSTING) {
      freezePosting = Boolean(row.value);
    } else if (row.key === SETTING_KEYS.FREEZE_COMMENTS) {
      freezeComments = Boolean(row.value);
    }
  }

  return { freezePosting, freezeComments };
}

export async function assertPostingNotFrozen(): Promise<void> {
  const { freezePosting } = await getPlatformFreezeState();
  if (freezePosting) {
    throw forbiddenError('New incident reporting is temporarily paused.');
  }
}

export async function assertCommentsNotFrozen(): Promise<void> {
  const { freezeComments } = await getPlatformFreezeState();
  if (freezeComments) {
    throw forbiddenError('Commenting is temporarily paused.');
  }
}

