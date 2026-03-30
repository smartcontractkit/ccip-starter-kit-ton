import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tolk',
    entrypoint: 'contracts/receiver_with_validateAndConfirm.tolk',
    withStackComments: true,
};
