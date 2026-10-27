import { createMemoryGroupState } from '../../../../src/js/adapters/memory/group-state.js';
import { describeGroupStateContract } from '../../../support/group-state-contract.js';

describeGroupStateContract('memory', createMemoryGroupState);
