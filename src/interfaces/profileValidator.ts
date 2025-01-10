export interface IProfileValidator {
    validate(profile: any): Promise<string[]>;
}