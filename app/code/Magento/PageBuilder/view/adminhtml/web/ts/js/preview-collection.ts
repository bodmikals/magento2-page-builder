/**
 * Copyright © Magento, Inc. All rights reserved.
 * See COPYING.txt for license details.
 */

import createContentType from "./content-type-factory";
import ContentTypeInterface from "./content-type.d";
import Preview from "./preview";

export default class PreviewCollection extends Preview {
    /**
     * Retrieve the preview child template
     *
     * @returns {string}
     */
    get previewChildTemplate(): string {
        return "Magento_PageBuilder/component/block/preview/children.html";
    }

    /**
     * Duplicate content type
     *
     * @param {ContentTypeInterface} child
     * @param {boolean} autoAppend
     * @returns {ContentTypeInterface}
     */
    public clone(child: ContentTypeInterface, autoAppend: boolean = true): ContentTypeInterface {
        const index = child.parent.getChildren().indexOf(child) + 1 || null;
        createContentType(
            child.config,
            child.parent,
            child.stageId,
            child.store.get(child.id),
        ).then((duplicate: ContentTypeInterface) => {
            if(child.children && child.children().length > 0) {
                // Duplicate the instances children into the new duplicate
                child.children().forEach((subChild: ContentTypeInterface) => {
                    subChild.parent = duplicate;
                    duplicate.preview.clone(subChild, true);
                });

            }

            if (autoAppend) {
                child.parent.addChild(duplicate, index);
            }
            this.dispatchContentTypeCloneEvents(child, duplicate, index);
        });
    }

    /**
     * Does the current instance have any children or values different from the default for it's type?
     *
     * @returns {boolean}
     */
    protected isConfigured() {
        if (this.parent.children().length > 0) {
            return true;
        }

        return super.isConfigured();
    }
}
