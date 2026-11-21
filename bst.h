/* bst.h - AVL (self-balancing binary search tree) of complaints, ordered by ID.
 * Search and insertion remain O(log n), including sorted insertion orders. */
#ifndef BST_H
#define BST_H

#include "complaint.h"

typedef struct BSTNode {
    Complaint *complaint;
    struct BSTNode *left;
    struct BSTNode *right;
    int height;                 /* cached subtree height; leaf nodes have height 1 */
} BSTNode;

typedef struct {
    BSTNode *root;
    int size;
} ComplaintBST;

void        bst_init(ComplaintBST *tree);
int         bst_insert(ComplaintBST *tree, Complaint *c);       /* 0 for invalid input or duplicate ID */
Complaint  *bst_search(const ComplaintBST *tree, int cid);      /* NULL if not found          */
Complaint **bst_inorder(const ComplaintBST *tree, int *count);  /* sorted by ID; caller free()s the array */
int         bst_height(const ComplaintBST *tree);               /* AVL height, empty tree = 0 */
void        bst_free(ComplaintBST *tree);                       /* frees nodes, not complaints */

#endif
