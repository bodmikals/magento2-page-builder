/**
 * Copyright © Magento, Inc. All rights reserved.
 * See COPYING.txt for license details.
 */

import ko from "knockout";
import _ from "underscore";
import {
    ContentTypeConfigAppearanceElementInterface,
    ContentTypeConfigAppearanceElementsInterface,
    ConverterInterface,
} from "../content-type-config.types";
import ConverterPool from "../converter/converter-pool";
import {DataObject} from "../data-store";
import MassConverterPool from "../mass-converter/converter-pool";
import {get} from "../utils/object";
import {fromSnakeToCamelCase} from "../utils/string";
import appearanceConfig from "./appearance-config";
import Master from "./master";
import {GeneratedElementsData} from "./observable-updater.types";
import Preview from "./preview";

export default class ObservableUpdater {
    private converterPool: typeof ConverterPool;
    private massConverterPool: typeof MassConverterPool;
    private converterResolver: (config: object) => string;
    private previousData: GeneratedElementsData = {};

    /**
     * @param {typeof ConverterPool} converterPool
     * @param {typeof MassConverterPool} massConverterPool
     * @param {(config: object) => string} converterResolver
     */
    constructor(
        converterPool: typeof ConverterPool,
        massConverterPool: typeof MassConverterPool,
        converterResolver: (config: object) => string,
    ) {
        this.converterPool = converterPool;
        this.massConverterPool = massConverterPool;
        this.converterResolver = converterResolver;
    }

    /**
     * Generate our data.ELEMENT.style Knockout observable objects for use within master and preview formats.
     *
     * @param {Preview} viewModel
     * @param {DataObject} data
     */
    public update(viewModel: Preview | Master, data: DataObject) {
        const appearance = data && data.appearance !== undefined ? data.appearance as string : undefined;
        const appearanceConfiguration = appearanceConfig(viewModel.contentType.config.name, appearance);
        if (undefined === appearanceConfiguration
            || undefined === appearanceConfiguration.elements
        ) {
            return;
        }

        const generatedData = this.generate(appearanceConfiguration.elements, appearanceConfiguration.converters, data);
        for (const element in generatedData) {
            if (generatedData.hasOwnProperty(element)) {
                if (viewModel.data[element] === undefined) {
                    viewModel.data[element] = {};
                }
                Object.keys(generatedData[element]).forEach((key) => {
                    if (viewModel.data[element][key] !== undefined && ko.isObservable(viewModel.data[element][key])) {
                        viewModel.data[element][key](generatedData[element][key]);
                    } else {
                        viewModel.data[element][key] = ko.observable(generatedData[element][key]);
                    }
                });
            }
        }
    }

    /**
     * Generate binding object to be applied to master format
     *
     * @param elements
     * @param converters
     * @param data
     */
    public generate(
        elements: ContentTypeConfigAppearanceElementsInterface,
        converters: ConverterInterface[],
        data: DataObject,
    ): GeneratedElementsData {
        const convertedData = this.convertData(data, converters);
        const generatedData: GeneratedElementsData = {};

        for (const elementName of Object.keys(elements)) {
            const elementConfig = elements[elementName];
            if (this.previousData[elementName] === undefined) {
                this.previousData[elementName] = {};
            }
            if (generatedData[elementName] === undefined) {
                generatedData[elementName] = {
                    attributes: {},
                    style: {},
                    css: {},
                    html: {},
                };
            }

            if (elementConfig.style !== undefined) {
                let previousStyles = {};
                if (this.previousData[elementName].style !== undefined) {
                    previousStyles = this.previousData[elementName].style;
                }
                generatedData[elementName].style = this.generateStyles(previousStyles, elementConfig, convertedData);
                this.previousData[elementName].style = generatedData[elementName].style;
            }

            if (elementConfig.attributes !== undefined) {
                generatedData[elementName].attributes = this.generateAttributes(
                    elementName,
                    elementConfig,
                    convertedData,
                );
            }

            if (elementConfig.html !== undefined) {
                generatedData[elementName].html = this.convertHtml(elementConfig, convertedData);
            }

            if (elementConfig.css !== undefined && elementConfig.css.var in convertedData) {
                let previousCss = {};
                if (this.previousData[elementName].css !== undefined) {
                    previousCss = this.previousData[elementName].css;
                }
                generatedData[elementName].css = this.generateCss(previousCss, elementConfig, convertedData);
                this.previousData[elementName].css = generatedData[elementName].css;
            }

            if (elementConfig.tag !== undefined && elementConfig.tag.var !== undefined) {
                if (generatedData[elementName][elementConfig.tag.var] === undefined) {
                    generatedData[elementName][elementConfig.tag.var] = "";
                }
                generatedData[elementName][elementConfig.tag.var] = convertedData[elementConfig.tag.var];
            }
        }

        return generatedData;
    }

    /**
     * Process data for elements before its converted to knockout format
     *
     * @param {object} data
     * @param {ConverterInterface[]} convertersConfig
     * @returns {object}
     */
    public convertData(data: DataObject, convertersConfig: ConverterInterface[]): DataObject {
        for (const converterConfig of convertersConfig) {
            data = this.massConverterPool.get(converterConfig.component).toDom(data, converterConfig.config);
        }
        return data;
    }

    /**
     * Generate style bindings for master format
     *
     * @param currentStyles
     * @param config
     * @param data
     */
    private generateStyles(
        currentStyles: {},
        config: ContentTypeConfigAppearanceElementInterface,
        data: DataObject,
    ): {} {
        let newStyles = this.convertStyle(config, data);

        if (currentStyles) {
            /**
             * If so we need to retrieve the previous styles applied to this element and create a new object
             * which forces all of these styles to be "false". Knockout doesn't clean existing styles when
             * applying new styles to an element. This resolves styles sticking around when they should be
             * removed.
             */
            const removeCurrentStyles = Object.keys(currentStyles)
                .reduce((object: object, styleName: string) => {
                    return Object.assign(object, {[styleName]: ""});
                }, {});

            if (!_.isEmpty(removeCurrentStyles)) {
                newStyles = _.extend(removeCurrentStyles, newStyles);
            }
        }

        return newStyles;
    }

    /**
     * Generate attributes for master format
     *
     * @param elementName
     * @param config
     * @param data
     */
    private generateAttributes(
        elementName: string,
        config: ContentTypeConfigAppearanceElementInterface,
        data: DataObject,
    ): {} {
        const attributeData = this.convertAttributes(config, data);
        attributeData["data-element"] = elementName;
        return attributeData;
    }

    /**
     * Generate CSS bindings for master format
     *
     * @param currentCss
     * @param config
     * @param data
     */
    private generateCss(currentCss: {}, config: ContentTypeConfigAppearanceElementInterface, data: DataObject): {} {
        const css = get<string>(data, config.css.var);
        const newClasses: {[key: string]: boolean} = {};

        if (css && css.length > 0) {
            css.toString().split(" ").map(
                (value: string) => newClasses[value] = true,
            );
        }
        for (const className of Object.keys(currentCss)) {
            if (!(className in newClasses)) {
                newClasses[className] = false;
            }
        }

        return newClasses;
    }

    /**
     * Convert attributes
     *
     * @param {object} config
     * @param {DataObject} data
     * @returns {object}
     */
    private convertAttributes(config: ContentTypeConfigAppearanceElementInterface, data: DataObject) {
        const result: DataObject = {};
        for (const attributeConfig of config.attributes) {
            if ("read" === attributeConfig.persistence_mode) {
                continue;
            }
            let value;
            if (!!attributeConfig.static) {
                value = attributeConfig.value;
            } else {
                value = get(data, attributeConfig.var);
            }
            const converter = this.converterResolver(attributeConfig);
            if (this.converterPool.get(converter)) {
                value = this.converterPool.get(converter).toDom(attributeConfig.var, data);
            }
            result[attributeConfig.name] = value;
        }

        return result;
    }

    /**
     * Convert style properties
     *
     * @param {object}config
     * @param {object}data
     * @returns {object}
     */
    private convertStyle(config: ContentTypeConfigAppearanceElementInterface, data: DataObject) {
        const result: {[key: string]: string} = {};
        if (config.style) {
            for (const propertyConfig of config.style) {
                if ("read" === propertyConfig.persistence_mode) {
                    continue;
                }
                let value: string | object;
                if (!!propertyConfig.static) {
                    value = propertyConfig.value;
                } else {
                    value = get(data, propertyConfig.var);
                    const converter = this.converterResolver(propertyConfig);
                    if (this.converterPool.get(converter)) {
                        value = this.converterPool.get(converter).toDom(propertyConfig.var, data);
                    }
                }
                if (typeof value === "object") {
                    _.extend(result, value);
                } else if (value !== undefined) {
                    result[fromSnakeToCamelCase(propertyConfig.name)] = value;
                }
            }
        }
        if (_.isEmpty(result)) {
            return null;
        }
        return result;
    }

    /**
     * Convert html property
     *
     * @param {object} config
     * @param {DataObject} data
     * @returns {string}
     */
    private convertHtml(config: ContentTypeConfigAppearanceElementInterface, data: DataObject) {
        let value = config.html.var ? get(data, config.html.var, config.html.placeholder) : config.html.placeholder;
        const converter = this.converterResolver(config.html);
        if (this.converterPool.get(converter)) {
            value = this.converterPool.get(converter).toDom(config.html.var, data);
        }
        // if value is empty, use placeholder
        if (typeof value === "string" && !value.length && config.html.placeholder) {
            value = config.html.placeholder;
        }
        return value;
    }
}
